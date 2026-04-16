import "dotenv/config";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import rawBody from "fastify-raw-body";
import { getBusinessHoursStatus } from "./business-hours.js";
import { ChatwootClient } from "./chatwoot-client.js";
import { config } from "./config.js";
import { DedupeStore } from "./dedupe-store.js";
import { ConversationStateStore } from "./fsm/state-store.js";
import { renderTemplate } from "./fsm/templates.js";
import type { ConversationTurn } from "./fsm/types.js";
import { ConversationOrchestrator } from "./orchestrator/harness.js";
import { loadSkills } from "./skills/repository.js";
import { verifyChatwootSignature } from "./signature.js";
import type { ChatwootWebhookPayload } from "./types.js";

const HISTORY_HARD_LIMIT = 40;

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
    skillIds: loadedSkills.map(skill => skill.id),
    agentEnabled: config.agentEnabled,
    agentHistoryLimit: config.agentHistoryLimit,
    agentMaxRetries: config.agentMaxRetries,
    businessHoursEnabled: config.businessHoursEnabled,
    businessTimezone: config.businessTimezone,
    businessWorkingDays: config.businessWorkingDays,
    businessStartMinutes: config.businessStartMinutes,
    businessEndMinutes: config.businessEndMinutes,
    openrouterModel: config.agentEnabled ? config.openrouterModel : "disabled"
  },
  "Orchestrator ready"
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
        email: null,
        problem: null,
        matchedSkillId: null,
        category: null,
        history: [],
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
      ? renderTemplate("OUT_OF_HOURS_HANDOFF")
      : decision.replyText ?? (decision.replyKey ? renderTemplate(decision.replyKey) : "");

  if (!outboundMessage) {
    request.log.error(
      { conversationId, decision },
      "Empty outbound message; skipping send"
    );
    return { ok: true, ignored: "empty_outbound" };
  }

  await chatwoot.sendMessage(conversationId, outboundMessage);

  const historyWithUser = appendTurn(currentState.history, {
    role: "user",
    content
  });

  if (decision.addAgentNote) {
    await chatwoot.sendPrivateNote(
      conversationId,
      buildAgentSummaryNote({
        email: decision.email,
        problem: decision.problem,
        matchedSkillId: decision.matchedSkillId,
        category: decision.category,
        agentSummary: decision.agentSummary,
        history: historyWithUser
      })
    );
  }

  const nextHistory = appendTurn(historyWithUser, {
    role: "assistant",
    content: outboundMessage
  });

  if (decision.action === "handoff") {
    await chatwoot.toggleStatus(conversationId, "open");
    if (decision.priority) {
      await chatwoot.togglePriority(conversationId, decision.priority);
    }
    request.log.info(
      {
        conversationId,
        signal: decision.signal,
        previousState: currentState.state,
        nextState: decision.nextState,
        source: orchestratorResult.trace.source,
        agentAction: orchestratorResult.trace.agentAction,
        agentError: orchestratorResult.trace.agentError,
        matchedSkillId: decision.matchedSkillId,
        category: decision.category,
        hasEmail: Boolean(decision.email),
        hasAgentSummary: Boolean(decision.agentSummary),
        priority: decision.priority,
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
        source: orchestratorResult.trace.source,
        agentAction: orchestratorResult.trace.agentAction,
        agentError: orchestratorResult.trace.agentError,
        matchedSkillId: decision.matchedSkillId,
        category: decision.category,
        unknownAttempts: decision.unknownAttempts
      },
      "Bot replied"
    );
  }

  conversationStateStore.set(conversationId, {
    state: decision.nextState,
    unknownAttempts: decision.unknownAttempts,
    email: decision.email,
    problem: decision.problem,
    matchedSkillId: decision.matchedSkillId,
    category: decision.category,
    history: decision.nextState === "cold_start" ? [] : nextHistory,
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

function appendTurn(
  history: ConversationTurn[],
  turn: ConversationTurn
): ConversationTurn[] {
  const next = [...history, turn];
  if (next.length > HISTORY_HARD_LIMIT) {
    return next.slice(next.length - HISTORY_HARD_LIMIT);
  }
  return next;
}

function buildAgentSummaryNote(params: {
  email: string | null;
  problem: string | null;
  matchedSkillId: string | null;
  category: string | null;
  agentSummary: string | null;
  history: ConversationTurn[];
}): string {
  const email = params.email || "no informado";
  const problem = params.problem || "sin detalle";
  const matchedSkillId = params.matchedSkillId || "sin skill";
  const category = params.category || "sin clasificar";
  const agentSummary = params.agentSummary || "sin resumen del agente";

  const lastUserTurns = params.history
    .filter(turn => turn.role === "user")
    .slice(-3)
    .map(turn => `  · ${turn.content}`)
    .join("\n");

  return [
    "Resumen preatencion:",
    `- Categoria: ${category}`,
    `- Email: ${email}`,
    `- Consulta: ${problem}`,
    `- Skill sugerida: ${matchedSkillId}`,
    `- Resumen del agente: ${agentSummary}`,
    lastUserTurns ? `- Ultimos mensajes del usuario:\n${lastUserTurns}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}
