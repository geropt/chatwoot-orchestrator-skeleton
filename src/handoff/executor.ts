import type { ChatwootClient } from "../chatwoot/client.js";
import type { Priority } from "../chatwoot/types.js";
import type { ConversationState } from "../state/conversation-store.js";
import type { ConversationStore } from "../state/conversation-store.js";
import type { HandoffReason } from "./rules.js";

export type HandoffInput = {
  conversationId: number;
  userMessage?: string;
  userFacingMessage?: string;
  reason: HandoffReason | "agent_decision";
  summary?: string;
  category?: string;
  priority?: Priority;
  matchedSkillId?: string;
  email?: string;
};

export class HandoffExecutor {
  constructor(
    private readonly chatwoot: ChatwootClient,
    private readonly store: ConversationStore
  ) {}

  async execute(input: HandoffInput): Promise<void> {
    const state = this.store.get(input.conversationId);

    if (input.userFacingMessage) {
      await this.chatwoot.sendMessage(
        input.conversationId,
        input.userFacingMessage
      );
      this.store.appendHistory(input.conversationId, {
        role: "assistant",
        content: input.userFacingMessage
      });
    }

    await this.chatwoot.toggleStatus(input.conversationId, "open");

    if (input.priority) {
      await this.chatwoot.togglePriority(input.conversationId, input.priority);
    }

    const note = formatAgentNote({ ...input, state });
    await this.chatwoot.sendPrivateNote(input.conversationId, note);

    this.store.update(input.conversationId, {
      phase: "handoff_active",
      matchedSkillId: input.matchedSkillId ?? state.matchedSkillId,
      email: input.email ?? state.email
    });
  }
}

function formatAgentNote(
  input: HandoffInput & { state: ConversationState }
): string {
  const lines: string[] = [];
  lines.push(`🤖 Derivación automática del bot`);
  lines.push(`Motivo: ${reasonLabel(input.reason)}`);

  if (input.priority && input.priority !== null) {
    lines.push(`Prioridad sugerida: ${input.priority}`);
  }
  if (input.category) {
    lines.push(`Categoría: ${input.category}`);
  }
  if (input.matchedSkillId) {
    lines.push(`Skill aplicado: ${input.matchedSkillId}`);
  }
  if (input.email) {
    lines.push(`Email: ${input.email}`);
  }
  lines.push(`Turnos: ${input.state.turns}`);

  if (input.summary) {
    lines.push(``);
    lines.push(`Resumen del caso:`);
    lines.push(input.summary);
  }

  const lastUserMessages = input.state.history
    .filter((h) => h.role === "user")
    .slice(-3)
    .map((h, i) => `${i + 1}. ${h.content}`);
  if (input.userMessage) {
    lastUserMessages.push(
      `${lastUserMessages.length + 1}. ${input.userMessage}`
    );
  }
  if (lastUserMessages.length > 0) {
    lines.push(``);
    lines.push(`Últimos mensajes del usuario:`);
    lines.push(...lastUserMessages);
  }

  return lines.join("\n");
}

function reasonLabel(reason: HandoffInput["reason"]): string {
  switch (reason) {
    case "explicit_request":
      return "Usuario pidió hablar con un humano";
    case "max_turns_reached":
      return "Se alcanzó el máximo de turnos sin resolver";
    case "llm_error":
      return "Fallo repetido del asistente";
    case "agent_decision":
      return "El asistente decidió derivar";
    default:
      return String(reason);
  }
}
