import type { ConversationState } from "../state/conversation-store.js";

export type HandoffReason =
  | "explicit_request"
  | "max_turns_reached"
  | "llm_error";

const HUMAN_REQUEST_REGEX =
  /\b(humano|humana|operador|operadora|agente real|agente humano|persona real|persona|asesor|asesora|representante)\b/i;

const EMERGENCY_REGEX =
  /\b(accidente|accident[ée]|lesi[oó]n|lesionado|lesionada|herido|herida|choqu[ée]|choque|chocaron|volqu[ée]|vuelco|incendio|fuego|humo|robo|asalt[oa]|asalto|me asaltaron|riesgo f[ií]sico|peligro|zona insegura|me siento insegur[oa]|estoy en peligro)\b/i;

export function detectExplicitHumanRequest(text: string): boolean {
  if (!text) return false;
  return HUMAN_REQUEST_REGEX.test(text);
}

export function detectEmergency(text: string): boolean {
  if (!text) return false;
  return EMERGENCY_REGEX.test(text);
}

export function detectMaxTurnsReached(
  state: ConversationState,
  maxTurns: number
): boolean {
  return state.turns >= maxTurns;
}

export function detectLlmExhausted(
  state: ConversationState,
  maxRetries: number
): boolean {
  return state.agentRetries >= maxRetries;
}

export function preLlmHandoffReason(params: {
  text: string;
  state: ConversationState;
  maxTurns: number;
}): HandoffReason | null {
  if (detectExplicitHumanRequest(params.text)) return "explicit_request";
  if (detectMaxTurnsReached(params.state, params.maxTurns))
    return "max_turns_reached";
  return null;
}
