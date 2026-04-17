import type { FastifyBaseLogger } from "fastify";
import type { ChatwootClient } from "./chatwoot-client.js";
import type { AppConfig } from "./config.js";
import type {
  ConversationPriority,
  ConversationTurn,
  HandoffSummary
} from "./fsm/types.js";

export type AdminTicketInput = {
  originalConversationId: number;
  originalDisplayId: number | null;
  contactId: number | null;
  category: string | null;
  problem: string | null;
  matchedSkillId: string | null;
  agentSummary: string | null;
  agentHandoffSummary: HandoffSummary | null;
  priority: ConversationPriority | null;
  stateEmail: string | null;
  history: ConversationTurn[];
};

export type AdminTicketResult = {
  ticketId: number;
  ticketDisplayId: number;
  ticketUrl: string;
  email: string;
};

export async function createAdminTicket(params: {
  input: AdminTicketInput;
  chatwoot: ChatwootClient;
  config: AppConfig;
  logger: FastifyBaseLogger;
}): Promise<AdminTicketResult | null> {
  const { input, chatwoot, config, logger } = params;

  if (!config.adminTicketInboxId) return null;
  if (!input.contactId) {
    logger.warn(
      { originalConversationId: input.originalConversationId },
      "Admin ticket skipped: missing contact_id in webhook"
    );
    return null;
  }

  const email = await resolveEmail(input, chatwoot, logger);
  if (!email) {
    logger.warn(
      {
        originalConversationId: input.originalConversationId,
        contactId: input.contactId
      },
      "Admin ticket skipped: no email available for contact"
    );
    return null;
  }

  const ticket = await chatwoot.createConversation({
    inboxId: config.adminTicketInboxId,
    contactId: input.contactId,
    sourceId: email
  });

  const ticketUrl = buildConversationUrl(
    config.chatwootBaseUrl,
    config.chatwootAccountId,
    ticket.id
  );
  const originalUrl = buildConversationUrl(
    config.chatwootBaseUrl,
    config.chatwootAccountId,
    input.originalConversationId
  );

  const initialMessage = buildTicketBody({ input, email, originalUrl });
  await chatwoot.sendMessage(ticket.id, initialMessage, {
    messageType: "incoming"
  });

  await chatwoot.sendPrivateNote(
    input.originalConversationId,
    `Ticket administrativo #${ticket.displayId} creado en inbox de email: ${ticketUrl}`
  );

  return {
    ticketId: ticket.id,
    ticketDisplayId: ticket.displayId,
    ticketUrl,
    email
  };
}

async function resolveEmail(
  input: AdminTicketInput,
  chatwoot: ChatwootClient,
  logger: FastifyBaseLogger
): Promise<string | null> {
  if (input.stateEmail) return input.stateEmail;
  if (!input.contactId) return null;

  try {
    const contact = await chatwoot.getContact(input.contactId);
    return contact.email;
  } catch (err) {
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        contactId: input.contactId
      },
      "Failed to fetch Chatwoot contact while resolving email"
    );
    return null;
  }
}

function buildConversationUrl(
  baseUrl: string,
  accountId: number,
  conversationId: number
): string {
  return `${baseUrl}/app/accounts/${accountId}/conversations/${conversationId}`;
}

function buildTicketBody(params: {
  input: AdminTicketInput;
  email: string;
  originalUrl: string;
}): string {
  const { input, email, originalUrl } = params;

  const headerLines: string[] = [];
  const banner = priorityBanner(input.priority);
  if (banner) headerLines.push(banner);
  headerLines.push(
    input.originalDisplayId
      ? `Consulta derivada desde WhatsApp (conversación #${input.originalDisplayId}).`
      : "Consulta derivada desde WhatsApp."
  );

  const tldrLines: string[] = ["TL;DR:"];
  const detail = input.agentHandoffSummary;
  if (detail) {
    tldrLines.push(`• Problema: ${detail.problem}`);
    if (detail.attempted) tldrLines.push(`• Intentos previos: ${detail.attempted}`);
    tldrLines.push(`• Motivo de derivación: ${detail.reason}`);
  } else if (input.agentSummary) {
    tldrLines.push(`• Resumen del agente: ${input.agentSummary}`);
  } else {
    tldrLines.push("• Sin resumen del agente.");
  }
  tldrLines.push(`• Email: ${email}`);
  tldrLines.push(`• Prioridad: ${input.priority ?? "normal"}`);

  const detalleLines: string[] = [
    "Detalle:",
    `- Categoría: ${input.category ?? "administrativo"}`,
    `- Skill aplicado: ${formatSkillReference(input.matchedSkillId)}`,
    `- Primer mensaje del usuario: ${input.problem ?? "sin detalle"}`,
    `- Conversación original: ${originalUrl}`
  ];

  const userTurns = input.history.filter(turn => turn.role === "user").length;
  const botTurns = input.history.filter(turn => turn.role === "assistant").length;
  detalleLines.push(
    `- Turnos: ${input.history.length} (${userTurns} usuario / ${botTurns} bot)`
  );

  const lastBotQuestion = findLastBotQuestion(input.history);
  if (lastBotQuestion) {
    detalleLines.push(`- Última pregunta del bot sin responder: "${lastBotQuestion}"`);
  }

  const transcript = input.history.length
    ? [
        "",
        "Transcripción completa:",
        ...input.history.map(turn => {
          const label = turn.role === "user" ? "Usuario" : "Bot";
          return `${label}: ${turn.content}`;
        })
      ].join("\n")
    : "";

  return [
    headerLines.join("\n"),
    "",
    tldrLines.join("\n"),
    "",
    detalleLines.join("\n"),
    transcript
  ]
    .filter(Boolean)
    .join("\n");
}

function priorityBanner(priority: ConversationPriority | null): string | null {
  if (priority === "urgent") return "🚨 URGENTE - revisar de inmediato";
  if (priority === "high") return "⚠️ Alta prioridad";
  return null;
}

function formatSkillReference(matchedSkillId: string | null): string {
  if (matchedSkillId) return matchedSkillId;
  return "ninguno (revisar manualmente)";
}

function findLastBotQuestion(history: ConversationTurn[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn.role !== "assistant") continue;
    if (!turn.content.includes("?")) continue;
    const sentences = turn.content
      .split(/(?<=\?)/)
      .map(s => s.trim())
      .filter(s => s.endsWith("?"));
    return sentences[sentences.length - 1] ?? null;
  }
  return null;
}
