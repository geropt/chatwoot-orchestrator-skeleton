import type { ConversationState } from "../state/conversation-store.js";

export type HandoffReason =
  | "explicit_request"
  | "max_turns_reached"
  | "llm_error";

const HUMAN_REQUEST_REGEX =
  /\b(humano|humana|operador|operadora|agente real|agente humano|persona real|persona|asesor|asesora|representante)\b/i;

export function detectExplicitHumanRequest(text: string): boolean {
  if (!text) return false;
  return HUMAN_REQUEST_REGEX.test(text);
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
