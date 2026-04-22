import type { JsonSchema } from "./tools/types.js";

export type AgentAction = "reply" | "ask_email" | "resolve" | "handoff";
export type AgentPriority = "urgent" | "high" | "medium" | "low";
export type AgentCategory = "tecnico" | "administrativo" | "general";

export type AgentDecision = {
  action: AgentAction;
  text: string;
  summary?: string;
  matchedSkillId?: string;
  category?: AgentCategory;
  priority?: AgentPriority;
};

export const EMIT_DECISION_TOOL = "emit_decision";

export const emitDecisionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "text"],
  properties: {
    action: {
      type: "string",
      enum: ["reply", "ask_email", "resolve", "handoff"],
      description:
        "reply: responder al usuario y seguir la conversación. ask_email: pedir el email del usuario. resolve: la consulta quedó resuelta, cerrar. handoff: derivar a un operador humano."
    },
    text: {
      type: "string",
      description: "Mensaje exacto a enviar al usuario por el canal."
    },
    summary: {
      type: "string",
      description:
        "Requerido si action=handoff. Resumen breve para que el operador entienda el caso."
    },
    matchedSkillId: {
      type: "string",
      description: "ID del skill del catálogo que mejor describe el caso, si aplica."
    },
    category: {
      type: "string",
      enum: ["tecnico", "administrativo", "general"],
      description: "Categoría del caso."
    },
    priority: {
      type: "string",
      enum: ["urgent", "high", "medium", "low"],
      description:
        "Solo para action=handoff. urgent si hay riesgo a personas; high si bloquea un alquiler en curso."
    }
  }
};

export function parseDecision(input: unknown): AgentDecision {
  if (!input || typeof input !== "object") {
    throw new Error("emit_decision input must be an object");
  }
  const obj = input as Record<string, unknown>;
  const action = obj.action;
  if (
    action !== "reply" &&
    action !== "ask_email" &&
    action !== "resolve" &&
    action !== "handoff"
  ) {
    throw new Error(`Invalid emit_decision.action: ${String(action)}`);
  }
  const text = obj.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("emit_decision.text is required");
  }
  if (action === "handoff" && typeof obj.summary !== "string") {
    throw new Error("emit_decision.summary is required for handoff");
  }

  const decision: AgentDecision = { action, text: text.trim() };
  if (typeof obj.summary === "string") decision.summary = obj.summary.trim();
  if (typeof obj.matchedSkillId === "string")
    decision.matchedSkillId = obj.matchedSkillId.trim();
  if (
    obj.category === "tecnico" ||
    obj.category === "administrativo" ||
    obj.category === "general"
  ) {
    decision.category = obj.category;
  }
  if (
    obj.priority === "urgent" ||
    obj.priority === "high" ||
    obj.priority === "medium" ||
    obj.priority === "low"
  ) {
    decision.priority = obj.priority;
  }
  return decision;
}
