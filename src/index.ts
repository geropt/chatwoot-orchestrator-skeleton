import "dotenv/config";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import rawBody from "fastify-raw-body";
import { getBusinessHoursStatus } from "./business-hours.js";
import { ChatwootClient } from "./chatwoot-client.js";
import { config } from "./config.js";
import { DedupeStore } from "./dedupe-store.js";
import { ConversationStateStore } from "./fsm/state-store.js";
import { renderTemplate } from "./fsm/templates.js";
import { ConversationOrchestrator } from "./orchestrator/harness.js";
import { loadSkills } from "./skills/repository.js";
import { verifyChatwootSignature } from "./signature.js";
import type { ChatwootWebhookPayload } from "./types.js";

const app = Fastify({
  logger: {
    level: config.logLevel
  }
});

await app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: "utf8",
  runFirst: true
});

const dedupe = new DedupeStore();
const chatwoot = new ChatwootClient(
  config.chatwootBaseUrl,
  config.chatwootAccountId,
  config.chatwootApiToken
);
const conversationStateStore = new ConversationStateStore();
const loadedSkills = loadSkills(config.skillsDir);
const orchestrator = new ConversationOrchestrator(config, loadedSkills);

app.log.info(
  {
    skillsLoaded: loadedSkills.length,
    skillsMinScore: config.skillsMinScore,
    skillIds: loadedSkills.map(skill => skill.id),
    enableAiSkillMatching: config.enableAiSkillMatching,
    enableAiSkillResponse: config.enableAiSkillResponse,
    aiSkillMinConfidence: config.aiSkillMinConfidence,
    aiSkillMaxCandidates: config.aiSkillMaxCandidates,
    enableAiFaqConfirmation: config.enableAiFaqConfirmation,
    aiFaqMinConfidence: config.aiFaqMinConfidence,
    businessHoursEnabled: config.businessHoursEnabled,
    businessTimezone: config.businessTimezone,
    businessWorkingDays: config.businessWorkingDays,
    businessStartMinutes: config.businessStartMinutes,
    businessEndMinutes: config.businessEndMinutes,
    openrouterModel:
      config.enableAiSkillMatching ||
      config.enableAiSkillResponse ||
      config.enableAiFaqConfirmation
        ? config.openrouterModel
        : "disabled"
  },
  "Skills catalog loaded"
);

app.get("/health", async () => ({ ok: true }));

const webhookHandler = async (
  request: FastifyRequest<{ Body: ChatwootWebhookPayload }>,
  reply: FastifyReply
) => {
  const raw =
    typeof request.rawBody === "string"
      ? request.rawBody
      : Buffer.isBuffer(request.rawBody)
        ? request.rawBody.toString("utf8")
      : JSON.stringify(request.body ?? {});

  const signature = request.headers["x-chatwoot-signature"];
  const timestamp = request.headers["x-chatwoot-timestamp"];

  const signatureValue = (Array.isArray(signature) ? signature[0] : signature)?.trim();
  const timestampValue = (Array.isArray(timestamp) ? timestamp[0] : timestamp)?.trim();

  const signatureValid = config.skipSignatureVerification
    ? true
    : verifyChatwootSignature({
        rawBody: raw,
        signature: signatureValue,
        timestamp: timestampValue,
        secret: config.chatwootWebhookSecret
      });

  if (!signatureValid) {
    request.log.warn(
      {
        hasSignatureHeader: Boolean(signatureValue),
        hasTimestampHeader: Boolean(timestampValue)
      },
      "Rejected webhook: invalid signature"
    );
    return reply.code(401).send({ ok: false });
  }

  const payload = request.body as ChatwootWebhookPayload;
  if (payload.event !== "message_created") {
    return { ok: true, ignored: "event_not_supported" };
  }

  if (!isIncomingContactMessage(payload)) {
    return { ok: true, ignored: "non_incoming_message" };
  }

  const conversationId = payload.conversation?.id;
  if (!conversationId) {
    request.log.warn({ payload }, "Conversation id missing in payload");
    return { ok: true, ignored: "missing_conversation_id" };
  }

  const delivery = request.headers["x-chatwoot-delivery"];
  const deliveryId = Array.isArray(delivery) ? delivery[0] : delivery;
  const dedupeKey = `${deliveryId ?? "no_delivery"}:${payload.id ?? "no_message_id"}`;

  if (dedupe.has(dedupeKey)) {
    return { ok: true, ignored: "duplicate_event" };
  }
  dedupe.set(dedupeKey);

  const content = (payload.content || "").trim();
  if (!content) {
    return { ok: true, ignored: "empty_content" };
  }

  const conversationStatus = normalizeConversationStatus(payload.conversation?.status);
  let currentState = conversationStateStore.get(conversationId);

  if (currentState.state === "handoff_active") {
    if (conversationStatus === "pending") {
      currentState = {
        state: "cold_start",
        unknownAttempts: 0,
        isUser: null,
        email: null,
        problem: null,
        matchedSkillId: null,
        updatedAt: Date.now()
      };
      conversationStateStore.set(conversationId, currentState);
      request.log.info({ conversationId }, "Resuming bot after pending status");
    } else {
      return {
        ok: true,
        ignored: "handoff_active",
        conversationStatus: conversationStatus ?? "unknown"
      };
    }
  }

  const orchestratorResult = await orchestrator.run({
    content,
    currentState
  });
  const decision = orchestratorResult.decision;

  const businessHours =
    decision.action === "handoff" ? getBusinessHoursStatus(new Date(), config) : null;

  const outboundMessage =
    decision.action === "handoff" && businessHours && !businessHours.isOpen
      ? `Estamos fuera de horario de atencion (${config.businessHoursLabel}). Ya dejamos tu consulta para que un agente la retome apenas vuelva el equipo.`
      : decision.replyText ?? renderTemplate(decision.replyKey);

  if (orchestratorResult.trace.topCandidates.length > 0) {
    request.log.info(
      {
        conversationId,
        currentState: currentState.state,
        skillSource: orchestratorResult.trace.source,
        localSkillId: orchestratorResult.trace.localSkillId,
        localSkillScore: orchestratorResult.trace.localSkillScore,
        aiSkillId: orchestratorResult.trace.aiSkillId,
        aiConfidence: orchestratorResult.trace.aiConfidence,
        aiReason: orchestratorResult.trace.aiReason,
        aiSkillResponseUsed: orchestratorResult.trace.aiSkillResponseUsed,
        selectedSkillId: orchestratorResult.trace.selectedSkillId,
        selectedSkillScore: orchestratorResult.trace.selectedSkillScore,
        topCandidates: orchestratorResult.trace.topCandidates
      },
      "Skill match evaluated"
    );
  }

  if (currentState.state === "awaiting_faq_confirmation") {
    request.log.info(
      {
        conversationId,
        aiFaqLabel: orchestratorResult.trace.aiFaqLabel,
        aiFaqConfidence: orchestratorResult.trace.aiFaqConfidence,
        aiFaqReason: orchestratorResult.trace.aiFaqReason
      },
      "FAQ confirmation classified"
    );
  }

  await chatwoot.sendMessage(conversationId, outboundMessage);

  if (decision.addAgentNote) {
    await chatwoot.sendPrivateNote(
      conversationId,
      buildAgentSummaryNote({
        isUser: decision.isUser,
        email: decision.email,
        problem: decision.problem,
        matchedSkillId: decision.matchedSkillId
      })
    );
  }

  if (decision.action === "handoff") {
    await chatwoot.toggleStatus(conversationId, "open");
    request.log.info(
      {
        conversationId,
        signal: decision.signal,
        previousState: currentState.state,
        nextState: decision.nextState,
        unknownAttempts: decision.unknownAttempts,
        isUser: decision.isUser,
        hasEmail: Boolean(decision.email),
        hasProblem: Boolean(decision.problem),
        matchedSkillId: decision.matchedSkillId,
        inBusinessHours: businessHours?.isOpen ?? null
      },
      "Handoff triggered"
    );
  } else {
    request.log.info(
      {
        conversationId,
        signal: decision.signal,
        previousState: currentState.state,
        nextState: decision.nextState,
        unknownAttempts: decision.unknownAttempts,
        isUser: decision.isUser,
        hasEmail: Boolean(decision.email),
        matchedSkillId: decision.matchedSkillId
      },
      "Bot replied"
    );
  }

  conversationStateStore.set(conversationId, {
    state: decision.nextState,
    unknownAttempts: decision.unknownAttempts,
    isUser: decision.isUser,
    email: decision.email,
    problem: decision.problem,
    matchedSkillId: decision.matchedSkillId,
    updatedAt: Date.now()
  });

  return { ok: true, action: decision.action, signal: decision.signal };
};

app.post<{ Body: ChatwootWebhookPayload }>(
  "/webhooks/chatwoot",
  { config: { rawBody: true } },
  webhookHandler
);

app.post<{ Body: ChatwootWebhookPayload }>(
  "/",
  { config: { rawBody: true } },
  webhookHandler
);

const port = config.port;
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`Server listening on port ${port}`);

function isIncomingContactMessage(payload: ChatwootWebhookPayload): boolean {
  if (payload.private) return false;

  const senderType = payload.sender?.type;
  if (senderType && senderType !== "contact") {
    return false;
  }

  const messageType = payload.message_type;
  if (typeof messageType === "string") {
    return messageType === "incoming";
  }

  if (typeof messageType === "number") {
    return messageType === 0;
  }

  return false;
}

function normalizeConversationStatus(
  value: string | number | undefined
): "open" | "pending" | "resolved" | "snoozed" | null {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (
      normalized === "open" ||
      normalized === "pending" ||
      normalized === "resolved" ||
      normalized === "snoozed"
    ) {
      return normalized;
    }
    return null;
  }

  if (typeof value === "number") {
    const statusByCode: Record<number, "open" | "resolved" | "pending" | "snoozed"> = {
      0: "open",
      1: "resolved",
      2: "pending",
      3: "snoozed"
    };
    return statusByCode[value] ?? null;
  }

  return null;
}

function buildAgentSummaryNote(params: {
  isUser: boolean | null;
  email: string | null;
  problem: string | null;
  matchedSkillId: string | null;
}): string {
  const userType =
    params.isUser === null ? "sin confirmar" : params.isUser ? "si" : "no";
  const email = params.email || "no informado";
  const problem = params.problem || "sin detalle";
  const matchedSkillId = params.matchedSkillId || "sin skill";

  return [
    "Resumen preatencion:",
    `- Usuario actual: ${userType}`,
    `- Email: ${email}`,
    `- Consulta: ${problem}`,
    `- Skill sugerida: ${matchedSkillId}`
  ].join("\n");
}
