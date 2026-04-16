import type { AppConfig } from "../config.js";
import { isConversationPriority } from "../fsm/engine.js";
import type {
  ConversationCategory,
  ConversationPriority,
  ConversationStateName,
  ConversationTurn
} from "../fsm/types.js";
import type { LoadedSkill } from "../skills/types.js";

export type AgentActionKind = "reply" | "ask_email" | "resolve" | "handoff";

export type AgentAction = {
  kind: AgentActionKind;
  text: string;
  summary: string | null;
  matchedSkillId: string | null;
  priority: ConversationPriority | null;
};

export type AgentContext = {
  content: string;
  category: ConversationCategory | null;
  email: string | null;
  history: ConversationTurn[];
  state: ConversationStateName;
};

export type AgentRunResult = {
  action: AgentAction | null;
  error: string | null;
  usedFallback: boolean;
};

export async function runAgentTurn(params: {
  context: AgentContext;
  skills: LoadedSkill[];
  config: AppConfig;
}): Promise<AgentRunResult> {
  const { context, skills, config } = params;

  if (!config.agentEnabled) {
    return { action: null, error: "agent_disabled", usedFallback: false };
  }

  const relevantSkills = filterSkillsByCategory(skills, context.category);
  const systemPrompt = buildSystemPrompt({
    category: context.category,
    email: context.email,
    state: context.state,
    skills: relevantSkills
  });
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...buildHistoryMessages(context.history, config.agentHistoryLimit),
    { role: "user" as const, content: context.content }
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.openrouterTimeoutMs);

  try {
    const response = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openrouterApiKey}`
      },
      body: JSON.stringify({
        model: config.openrouterModel,
        temperature: config.agentTemperature,
        max_tokens: config.agentMaxTokens,
        response_format: { type: "json_object" },
        messages
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        action: null,
        error: `openrouter_${response.status}:${body.slice(0, 200)}`,
        usedFallback: false
      };
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = body.choices?.[0]?.message?.content ?? "";
    const parsed = parseAgentJson(raw);
    if (!parsed) {
      return { action: null, error: "agent_parse_error", usedFallback: false };
    }

    const action = normalizeAction(parsed, relevantSkills);
    if (!action) {
      return { action: null, error: "agent_invalid_action", usedFallback: false };
    }

    return { action, error: null, usedFallback: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return { action: null, error: `agent_exception:${message}`, usedFallback: false };
  } finally {
    clearTimeout(timeout);
  }
}

function filterSkillsByCategory(
  skills: LoadedSkill[],
  category: ConversationCategory | null
): LoadedSkill[] {
  if (category === "general") return [];
  if (category === null) {
    return skills.filter(skill => skill.category !== "general");
  }
  return skills.filter(
    skill => skill.category === null || skill.category === category
  );
}

function buildSystemPrompt(params: {
  category: ConversationCategory | null;
  email: string | null;
  state: ConversationStateName;
  skills: LoadedSkill[];
}): string {
  const { category, email, state, skills } = params;

  const catalog = skills.length
    ? skills.map(formatSkillForPrompt).join("\n\n")
    : "(no hay skills especificos para esta categoria)";

  const knownData = [
    `- categoria: ${category ?? "sin clasificar (el usuario todavia no eligio)"}`,
    `- email del usuario: ${email ?? "no informado"}`,
    `- estado actual: ${state}`
  ].join("\n");

  return [
    "Rol: sos el asistente virtual de soporte de MyKeego (car sharing en Argentina). Atendes por WhatsApp.",
    "Tono: natural, cercano, rioplatense, sin sonar robotico. Sin emojis. Mensajes breves (1-3 oraciones).",
    "Objetivo: acompañar al usuario paso a paso para resolver lo que se pueda. Derivar a humano solo cuando el skill lo indica, cuando ya se intento y no funciono, o ante una emergencia real.",
    "",
    "Como usar el catalogo de skills:",
    "1. Identifica el skill que matchea (mira 'cuando aplica' y el titulo).",
    "2. Si hay 'preguntas diagnosticas' y todavia te falta contexto, hace UNA sola pregunta (no todas juntas) para entender el caso.",
    "3. Con contexto suficiente, guia al usuario por los 'pasos' del skill (de a uno o dos por mensaje; no vomites la lista entera).",
    "4. Despues de un paso, verifica si funciono antes de pasar al siguiente.",
    "5. Si se cumple un criterio de 'cuando derivar' del skill, hace handoff con summary.",
    "6. Si ningun skill encaja, podes hacer preguntas basicas de sentido comun (sin inventar procedimientos especificos) antes de decidir si derivar.",
    "",
    "Reglas duras:",
    "- Emergencia real (accidente con lesion, choque, incendio, robo en curso): handoff inmediato.",
    "- No inventes politicas, precios, plazos ni datos de la cuenta.",
    "- No prometas reembolsos, desbloqueos ni compensaciones; eso lo decide un humano.",
    "- Si ya diste un paso y el usuario dice que no funciono, pasa al siguiente paso del skill o deriva si ya se agotaron.",
    "- Si el usuario ya dio su email, no lo pidas de vuelta.",
    "",
    "Acciones disponibles (elegi UNA por turno):",
    "- reply: seguis conversando. Usala para preguntar, guiar un paso, o verificar si funciono.",
    "- ask_email: pedile el email (solo si el skill lo requiere y todavia no lo tenes).",
    "- resolve: el usuario confirmo que se resolvio o se despidio bien. Despedite breve.",
    "- handoff: no podes resolverlo. Avisale al usuario y dejale un summary al operador.",
    "",
    "Formato de salida: JSON estricto, sin texto antes o despues. Estructura:",
    '{ "action": "reply" | "ask_email" | "resolve" | "handoff", "text": "...", "summary": "..." | null, "matched_skill_id": "..." | null, "priority": "urgent" | "high" | null }',
    "",
    'Campo "text" (OBLIGATORIO, siempre va al usuario por WhatsApp):',
    "- Le hablas al usuario en SEGUNDA persona (vos/te/tu). Nunca en tercera.",
    "- No describas al usuario ni a vos mismo desde afuera.",
    '- Correcto en handoff: "Te paso con un operador para que te ayude con esto."',
    '- INCORRECTO: "El usuario informa que X" o "Derivo a un operador".',
    "",
    'Campo "summary" (solo si action=handoff, null en el resto):',
    "- NOTA INTERNA para el operador. Nunca la lee el usuario.",
    "- Tercera persona, 1 oracion, con el problema y lo ya intentado.",
    '- Ejemplo: "Usuario reporta que el auto no abre; ya reinicio la app y confirma tener señal."',
    "",
    'Campo "matched_skill_id": id del skill que estas aplicando. Null si ninguno encaja.',
    "",
    'Campo "priority" (solo tiene efecto si action=handoff; en el resto poné null):',
    '- "urgent": emergencia real con riesgo a personas (accidente con lesion, choque, incendio, robo en curso, auto parado en lugar peligroso).',
    '- "high": caso sensible que bloquea al usuario y necesita atencion rapida (auxilio mecanico en ruta sin lesiones, auto no abre con reserva activa, cobro erroneo urgente).',
    "- null: caso administrativo o consulta comun sin urgencia.",
    "",
    "Datos conocidos:",
    knownData,
    "",
    "Catalogo de skills para esta categoria:",
    catalog
  ].join("\n");
}

function formatSkillForPrompt(skill: LoadedSkill): string {
  const lines: string[] = [
    `- id: ${skill.id}`,
    `  titulo: ${skill.title}`,
    `  pedir_email: ${skill.askEmail ? "si" : "no"}`
  ];
  if (skill.description) {
    lines.push(`  descripcion: ${skill.description}`);
  }
  appendBulletSection(lines, "cuando aplica", skill.triggers);
  appendBulletSection(lines, "preguntas diagnosticas", skill.diagnosticQuestions);
  appendBulletSection(lines, "pasos", skill.steps);
  appendBulletSection(lines, "cuando derivar", skill.escalateWhen);
  appendBulletSection(lines, "restricciones", skill.constraints);
  return lines.join("\n");
}

function appendBulletSection(lines: string[], label: string, items: string[]): void {
  if (!items.length) return;
  lines.push(`  ${label}:`);
  for (const item of items) {
    lines.push(`    - ${item}`);
  }
}

function buildHistoryMessages(
  history: ConversationTurn[],
  limit: number
): Array<{ role: "user" | "assistant"; content: string }> {
  if (!history.length) {
    return [];
  }
  const trimmed = history.slice(-limit);
  return trimmed.map(turn => ({ role: turn.role, content: turn.content }));
}

function parseAgentJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const direct = safeParse(trimmed);
  if (direct) {
    return direct;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  return safeParse(trimmed.slice(start, end + 1));
}

function safeParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeAction(
  parsed: Record<string, unknown>,
  skills: LoadedSkill[]
): AgentAction | null {
  const kindRaw = parsed.action;
  if (
    kindRaw !== "reply" &&
    kindRaw !== "ask_email" &&
    kindRaw !== "resolve" &&
    kindRaw !== "handoff"
  ) {
    return null;
  }

  const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
  if (!text) {
    return null;
  }

  const summaryRaw = parsed.summary;
  const summary =
    typeof summaryRaw === "string" && summaryRaw.trim()
      ? summaryRaw.trim()
      : null;
  if (kindRaw === "handoff" && !summary) {
    return null;
  }

  const matchedRaw = parsed.matched_skill_id;
  let matchedSkillId: string | null = null;
  if (typeof matchedRaw === "string" && matchedRaw.trim()) {
    const normalized = matchedRaw.trim();
    const exists = skills.some(skill => skill.id === normalized);
    matchedSkillId = exists ? normalized : null;
  }

  const priorityRaw = parsed.priority;
  let priority: ConversationPriority | null = null;
  if (typeof priorityRaw === "string") {
    const normalized = priorityRaw.trim().toLowerCase();
    if (isConversationPriority(normalized)) {
      priority = normalized;
    }
  }

  return { kind: kindRaw, text, summary, matchedSkillId, priority };
}
