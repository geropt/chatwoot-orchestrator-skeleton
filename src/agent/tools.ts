import { isConversationPriority } from "../fsm/engine.js";
import type {
  ConversationCategory,
  ConversationPriority,
  HandoffSummary
} from "../fsm/types.js";
import type { LoadedSkill } from "../skills/types.js";

export type AgentActionKind = "reply" | "ask_email" | "resolve" | "handoff";

export type AgentAction = {
  kind: AgentActionKind;
  text: string;
  summary: string | null;
  handoffSummary: HandoffSummary | null;
  matchedSkillId: string | null;
  priority: ConversationPriority | null;
  categoryChange: ConversationCategory | null;
};

const CATEGORY_VALUES: ReadonlyArray<ConversationCategory> = [
  "tecnico",
  "administrativo",
  "general"
];

function resolveCategoryChange(value: unknown): ConversationCategory | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (CATEGORY_VALUES as string[]).includes(normalized)
    ? (normalized as ConversationCategory)
    : null;
}

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolboxLogger = {
  info: (payload: Record<string, unknown>, msg?: string) => void;
  warn: (payload: Record<string, unknown>, msg?: string) => void;
  error: (payload: Record<string, unknown>, msg?: string) => void;
};

export type ToolboxContext = {
  conversationId: number | null;
  contactId: number | null;
  email: string | null;
  logger: ToolboxLogger;
};

export type ToolResult = {
  ok: boolean;
  content: string;
};

export type TerminalToolDef = {
  kind: "terminal";
  name: AgentActionKind;
  schema: ToolSchema;
  toAction(
    args: Record<string, unknown>,
    skills: LoadedSkill[]
  ): AgentAction | null;
};

export type EffectToolDef = {
  kind: "effect";
  name: string;
  schema: ToolSchema;
  promptHint?: string;
  run(args: Record<string, unknown>, ctx: ToolboxContext): Promise<ToolResult>;
};

export type ToolDef = TerminalToolDef | EffectToolDef;

export type ToolRegistry = {
  get(name: string): ToolDef | undefined;
  schemas(): ToolSchema[];
  terminals(): TerminalToolDef[];
  effects(): EffectToolDef[];
};

export function createToolRegistry(defs: ToolDef[]): ToolRegistry {
  const byName = new Map<string, ToolDef>();
  for (const def of defs) {
    if (byName.has(def.name)) {
      throw new Error(`Duplicate tool name in registry: ${def.name}`);
    }
    byName.set(def.name, def);
  }

  const terminals = defs.filter(
    (def): def is TerminalToolDef => def.kind === "terminal"
  );
  if (!terminals.length) {
    throw new Error("Tool registry requires at least one terminal tool");
  }

  const effects = defs.filter(
    (def): def is EffectToolDef => def.kind === "effect"
  );

  return {
    get: name => byName.get(name),
    schemas: () => defs.map(def => def.schema),
    terminals: () => terminals,
    effects: () => effects
  };
}

const CATEGORY_CHANGE_PROPERTY = {
  type: ["string", "null"],
  enum: ["tecnico", "administrativo", "general", null],
  description:
    "Solo usar cuando el usuario revela que su intent real no coincide con la categoria actual (ej. entro como informativa y resulta ser cliente con un problema). Pasa el nombre de la categoria correcta para reasignar la conversacion. Null o ausente si no hay cambio."
} as const;

const REPLY_TOOL: TerminalToolDef = {
  kind: "terminal",
  name: "reply",
  schema: {
    type: "function",
    function: {
      name: "reply",
      description:
        "Responder al usuario para seguir conversando: hacer una pregunta, guiar un paso, o verificar si algo funciono.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: {
            type: "string",
            description:
              "Mensaje al usuario en segunda persona (vos/te). 1 a 3 oraciones."
          },
          matched_skill_id: {
            type: ["string", "null"],
            description:
              "Id del skill que estas aplicando. Null si ninguno encaja."
          },
          category_change: CATEGORY_CHANGE_PROPERTY
        }
      }
    }
  },
  toAction(args, skills) {
    const text = readText(args.text);
    if (!text) return null;
    return {
      kind: "reply",
      text,
      summary: null,
      handoffSummary: null,
      matchedSkillId: resolveMatchedSkillId(args.matched_skill_id, skills),
      priority: null,
      categoryChange: resolveCategoryChange(args.category_change)
    };
  }
};

const ASK_EMAIL_TOOL: TerminalToolDef = {
  kind: "terminal",
  name: "ask_email",
  schema: {
    type: "function",
    function: {
      name: "ask_email",
      description:
        "Pedirle al usuario su email de registro. Usar cuando esta en categoria tecnico o administrativo y todavia no lo tenemos.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: {
            type: "string",
            description: "Pedido breve de email, en segunda persona."
          },
          matched_skill_id: {
            type: ["string", "null"]
          },
          category_change: CATEGORY_CHANGE_PROPERTY
        }
      }
    }
  },
  toAction(args, skills) {
    const text = readText(args.text);
    if (!text) return null;
    return {
      kind: "ask_email",
      text,
      summary: null,
      handoffSummary: null,
      matchedSkillId: resolveMatchedSkillId(args.matched_skill_id, skills),
      priority: null,
      categoryChange: resolveCategoryChange(args.category_change)
    };
  }
};

const RESOLVE_TOOL: TerminalToolDef = {
  kind: "terminal",
  name: "resolve",
  schema: {
    type: "function",
    function: {
      name: "resolve",
      description:
        "Cerrar la conversacion. El usuario confirmo que se resolvio o se despidio bien.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: {
            type: "string",
            description: "Despedida breve en segunda persona."
          }
        }
      }
    }
  },
  toAction(args) {
    const text = readText(args.text);
    if (!text) return null;
    return {
      kind: "resolve",
      text,
      summary: null,
      handoffSummary: null,
      matchedSkillId: null,
      priority: null,
      categoryChange: null
    };
  }
};

const HANDOFF_TOOL: TerminalToolDef = {
  kind: "terminal",
  name: "handoff",
  schema: {
    type: "function",
    function: {
      name: "handoff",
      description:
        "Derivar a un operador humano. Usar si no podes resolverlo, se agotaron los pasos del skill, o es una emergencia real.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["text", "summary_problem", "summary_reason"],
        properties: {
          text: {
            type: "string",
            description:
              "Mensaje al usuario avisando que lo paso con un operador, en segunda persona."
          },
          summary_problem: {
            type: "string",
            description:
              "Nota interna para el operador. Que reporta el usuario en concreto. Tercera persona, 1 oracion. Ej: 'Reporta que el auto no abre desde la app aunque la reserva figura activa'."
          },
          summary_attempted: {
            type: ["string", "null"],
            description:
              "Que pasos se le guiaron y resultado. Tercera persona, breve. Si no se intento nada (ej. emergencia), null. Ej: 'Se le pidio reiniciar la app y verificar senal; ambos sin exito'."
          },
          summary_reason: {
            type: "string",
            description:
              "Por que se deriva ahora. Tercera persona, 1 oracion. Ej: 'Pasos del skill agotados', 'Emergencia con riesgo a personas', 'Usuario solicita hablar con humano', 'Consulta fuera del catalogo de skills'."
          },
          matched_skill_id: {
            type: ["string", "null"]
          },
          priority: {
            type: ["string", "null"],
            enum: ["urgent", "high", null],
            description:
              "urgent: emergencia real con riesgo. high: caso sensible que bloquea al usuario. null: resto."
          }
        }
      }
    }
  },
  toAction(args, skills) {
    const text = readText(args.text);
    if (!text) return null;

    const problem = readText(args.summary_problem);
    if (!problem) return null;

    const reason = readText(args.summary_reason);
    if (!reason) return null;

    const attempted = readText(args.summary_attempted);

    let priority: ConversationPriority | null = null;
    if (typeof args.priority === "string") {
      const normalized = args.priority.trim().toLowerCase();
      if (isConversationPriority(normalized)) {
        priority = normalized;
      }
    }

    const handoffSummary: HandoffSummary = { problem, attempted, reason };
    const summary = formatHandoffSummary(handoffSummary);

    return {
      kind: "handoff",
      text,
      summary,
      handoffSummary,
      matchedSkillId: resolveMatchedSkillId(args.matched_skill_id, skills),
      priority,
      categoryChange: null
    };
  }
};

function formatHandoffSummary(s: HandoffSummary): string {
  const parts = [s.problem];
  if (s.attempted) parts.push(`Intentos: ${s.attempted}`);
  parts.push(`Motivo de derivacion: ${s.reason}`);
  return parts.join(". ");
}

export const DEFAULT_TERMINAL_TOOLS: TerminalToolDef[] = [
  REPLY_TOOL,
  ASK_EMAIL_TOOL,
  RESOLVE_TOOL,
  HANDOFF_TOOL
];

export function createDefaultToolRegistry(
  effectTools: EffectToolDef[] = []
): ToolRegistry {
  return createToolRegistry([...DEFAULT_TERMINAL_TOOLS, ...effectTools]);
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveMatchedSkillId(
  raw: unknown,
  skills: LoadedSkill[]
): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim();
  if (!normalized) return null;
  return skills.some(skill => skill.id === normalized) ? normalized : null;
}
