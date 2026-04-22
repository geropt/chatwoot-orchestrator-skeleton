import type { Agent } from "../agent/agent.js";
import type { AgentDecision } from "../agent/decision.js";
import type { HandoffExecutor } from "../handoff/executor.js";
import { preLlmHandoffReason } from "../handoff/rules.js";
import type { ConversationStore } from "../state/conversation-store.js";
import type { DedupeStore } from "../state/dedupe-store.js";
import type { ChatwootClient } from "./client.js";
import { verifyChatwootSignature } from "./signature.js";
import type { ChatwootWebhookPayload, WebhookHeaders } from "./types.js";

export type WebhookResult = {
  ok: boolean;
  action?: string;
  ignored?: string;
};

export type WebhookDeps = {
  chatwoot: ChatwootClient;
  agent: Agent;
  handoff: HandoffExecutor;
  store: ConversationStore;
  dedupe: DedupeStore;
  config: {
    webhookSecret: string;
    skipSignatureVerification: boolean;
    maxTurns: number;
    maxRetries: number;
  };
};

export async function handleWebhook(
  deps: WebhookDeps,
  input: {
    rawBody: string;
    headers: WebhookHeaders;
    payload: ChatwootWebhookPayload;
  }
): Promise<WebhookResult> {
  const { rawBody, headers, payload } = input;

  if (!deps.config.skipSignatureVerification) {
    const ok = verifyChatwootSignature({
      rawBody,
      secret: deps.config.webhookSecret,
      signature: headers.signature,
      timestamp: headers.timestamp
    });
    if (!ok) {
      return { ok: false, ignored: "invalid_signature" };
    }
  }

  if (payload.event !== "message_created") {
    return { ok: true, ignored: "event_not_supported" };
  }

  if (
    payload.private === true ||
    !isIncoming(payload.message_type) ||
    isAgentSender(payload.sender?.type)
  ) {
    return { ok: true, ignored: "not_user_message" };
  }

  const conversationId = payload.conversation?.id;
  if (typeof conversationId !== "number") {
    return { ok: true, ignored: "missing_conversation_id" };
  }

  const content = typeof payload.content === "string" ? payload.content.trim() : "";
  if (!content) {
    return { ok: true, ignored: "empty_content" };
  }

  const dedupeKey = `${headers.delivery ?? ""}:${payload.id ?? ""}:${conversationId}`;
  if (deps.dedupe.seenRecently(dedupeKey)) {
    return { ok: true, ignored: "duplicate_delivery" };
  }

  const state = deps.store.get(conversationId);

  if (state.phase === "handoff_active") {
    const status = normalizeStatus(payload.conversation?.status);
    if (status === "pending") {
      deps.store.reset(conversationId);
    } else {
      return { ok: true, ignored: "handoff_active" };
    }
  }

  const contactId = payload.conversation?.contact_inbox?.contact_id;
  const email =
    state.email ??
    (typeof payload.sender?.email === "string" ? payload.sender.email : undefined);

  const preHandoff = preLlmHandoffReason({
    text: content,
    state,
    maxTurns: deps.config.maxTurns
  });

  if (preHandoff) {
    await deps.handoff.execute({
      conversationId,
      reason: preHandoff,
      userMessage: content,
      userFacingMessage:
        preHandoff === "explicit_request"
          ? "Perfecto, te estoy derivando con un operador. En breve te escribe."
          : "Te derivo con un operador para que pueda ayudarte mejor.",
      email
    });
    return { ok: true, action: `handoff:${preHandoff}` };
  }

  try {
    const decision = await deps.agent.run({
      state,
      userMessage: content,
      ctx: { conversationId, contactId, email }
    });

    deps.store.appendHistory(conversationId, { role: "user", content });
    deps.store.update(conversationId, {
      turns: state.turns + 1,
      agentRetries: 0,
      matchedSkillId: decision.matchedSkillId ?? state.matchedSkillId,
      email
    });

    await applyDecision({
      decision,
      conversationId,
      chatwoot: deps.chatwoot,
      handoff: deps.handoff,
      store: deps.store,
      userMessage: content,
      email
    });

    return { ok: true, action: decision.action };
  } catch (err) {
    deps.store.update(conversationId, {
      agentRetries: state.agentRetries + 1
    });
    const refreshed = deps.store.get(conversationId);
    if (refreshed.agentRetries >= deps.config.maxRetries) {
      await deps.handoff.execute({
        conversationId,
        reason: "llm_error",
        userMessage: content,
        userFacingMessage:
          "Tuve un problema para procesar tu mensaje. Te derivo con un operador.",
        summary: `Error del agente tras ${refreshed.agentRetries} intentos: ${
          err instanceof Error ? err.message : String(err)
        }`,
        email
      });
      return { ok: true, action: "handoff:llm_error" };
    }
    throw err;
  }
}

async function applyDecision(params: {
  decision: AgentDecision;
  conversationId: number;
  chatwoot: ChatwootClient;
  handoff: HandoffExecutor;
  store: ConversationStore;
  userMessage: string;
  email?: string;
}): Promise<void> {
  const { decision, conversationId, chatwoot, handoff, store } = params;

  if (decision.action === "handoff") {
    await handoff.execute({
      conversationId,
      reason: "agent_decision",
      userMessage: params.userMessage,
      userFacingMessage: decision.text,
      summary: decision.summary,
      category: decision.category,
      priority: decision.priority ?? null,
      matchedSkillId: decision.matchedSkillId,
      email: params.email
    });
    return;
  }

  await chatwoot.sendMessage(conversationId, decision.text);
  store.appendHistory(conversationId, {
    role: "assistant",
    content: decision.text
  });

  if (decision.action === "ask_email") {
    store.update(conversationId, { phase: "awaiting_email" });
    return;
  }

  if (decision.action === "resolve") {
    await chatwoot.toggleStatus(conversationId, "resolved");
    store.reset(conversationId);
    return;
  }

  store.update(conversationId, { phase: "active" });
}

function isIncoming(type: string | number | undefined): boolean {
  if (type === "incoming") return true;
  if (type === 0) return true;
  return false;
}

function isAgentSender(type: string | undefined): boolean {
  if (!type) return false;
  const normalized = type.toLowerCase();
  return (
    normalized === "user" ||
    normalized === "agent" ||
    normalized === "agent_bot" ||
    normalized === "system"
  );
}

function normalizeStatus(
  status: string | number | undefined
): "open" | "pending" | "resolved" | "snoozed" | null {
  if (typeof status === "string") {
    if (
      status === "open" ||
      status === "pending" ||
      status === "resolved" ||
      status === "snoozed"
    ) {
      return status;
    }
  }
  if (typeof status === "number") {
    if (status === 0) return "open";
    if (status === 1) return "resolved";
    if (status === 2) return "pending";
    if (status === 3) return "snoozed";
  }
  return null;
}
