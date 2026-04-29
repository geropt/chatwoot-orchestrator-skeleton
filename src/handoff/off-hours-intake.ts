import type { AgentDecision } from "../agent/decision.js";
import type { ChatwootClient } from "../chatwoot/client.js";
import type { Priority } from "../chatwoot/types.js";
import type { ConversationState, ConversationStore } from "../state/conversation-store.js";
import type { BusinessHoursStatus } from "../support/business-hours.js";
import type { HandoffReason } from "./rules.js";

export type OffHoursIntakeReason =
  | HandoffReason
  | "agent_decision"
  | "emergency";

export type OffHoursIntakeInput = {
  conversationId: number;
  reason: OffHoursIntakeReason;
  userMessage?: string;
  userFacingMessage: string;
  hours: BusinessHoursStatus;
  summary?: string;
  category?: AgentDecision["category"];
  priority?: Priority;
  matchedSkillId?: string;
  email?: string;
};

export class OffHoursIntakeExecutor {
  constructor(
    private readonly chatwoot: ChatwootClient,
    private readonly store: ConversationStore
  ) {}

  async execute(input: OffHoursIntakeInput): Promise<void> {
    const state = this.store.get(input.conversationId);

    await this.chatwoot.sendMessage(input.conversationId, input.userFacingMessage);
    this.store.appendHistory(input.conversationId, {
      role: "assistant",
      content: input.userFacingMessage
    });

    if (input.priority) {
      await this.chatwoot.togglePriority(input.conversationId, input.priority);
    }

    await this.chatwoot.sendPrivateNote(
      input.conversationId,
      formatOffHoursNote({ ...input, state })
    );

    if (input.hours.nextOpenAt) {
      await this.chatwoot.toggleStatus(input.conversationId, "snoozed", {
        snoozedUntil: input.hours.nextOpenAt
      });
    } else {
      await this.chatwoot.toggleStatus(input.conversationId, "pending");
    }

    this.store.update(input.conversationId, {
      phase: "off_hours_intake",
      matchedSkillId: input.matchedSkillId ?? state.matchedSkillId,
      email: input.email ?? state.email
    });
  }
}

function formatOffHoursNote(
  input: OffHoursIntakeInput & { state: ConversationState }
): string {
  const lines: string[] = [];
  lines.push("Derivacion diferida fuera de horario");
  lines.push(`Motivo: ${reasonLabel(input.reason)}`);
  lines.push(`Horario local: ${input.hours.localDate} ${input.hours.localTime}`);
  if (input.hours.nextOpenAt) {
    lines.push(`Proxima apertura: ${input.hours.nextOpenAt.toISOString()}`);
  }
  if (input.priority) {
    lines.push(`Prioridad sugerida: ${input.priority}`);
  }
  if (input.category) {
    lines.push(`Categoria: ${input.category}`);
  }
  if (input.matchedSkillId) {
    lines.push(`Skill aplicado: ${input.matchedSkillId}`);
  }
  if (input.email) {
    lines.push(`Email: ${input.email}`);
  }
  lines.push(`Turnos: ${input.state.turns}`);

  if (input.summary) {
    lines.push("");
    lines.push("Resumen del caso:");
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
    lines.push("");
    lines.push("Ultimos mensajes del usuario:");
    lines.push(...lastUserMessages);
  }

  return lines.join("\n");
}

function reasonLabel(reason: OffHoursIntakeReason): string {
  switch (reason) {
    case "explicit_request":
      return "Usuario pidio hablar con un humano fuera de horario";
    case "max_turns_reached":
      return "Se alcanzo el maximo de turnos fuera de horario";
    case "llm_error":
      return "Fallo repetido del asistente fuera de horario";
    case "agent_decision":
      return "El asistente decidio derivar fuera de horario";
    case "emergency":
      return "Emergencia reportada fuera de horario";
    default:
      return String(reason);
  }
}
