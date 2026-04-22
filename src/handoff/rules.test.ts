import { describe, expect, it } from "vitest";
import {
  detectExplicitHumanRequest,
  preLlmHandoffReason
} from "./rules.js";
import type { ConversationState } from "../state/conversation-store.js";

function makeState(partial?: Partial<ConversationState>): ConversationState {
  return {
    phase: "active",
    turns: 0,
    history: [],
    agentRetries: 0,
    updatedAt: Date.now(),
    ...partial
  };
}

describe("detectExplicitHumanRequest", () => {
  it("matches explicit requests in es-AR", () => {
    expect(detectExplicitHumanRequest("quiero hablar con un humano")).toBe(true);
    expect(detectExplicitHumanRequest("pásame con un operador")).toBe(true);
    expect(detectExplicitHumanRequest("necesito un agente real ya")).toBe(true);
    expect(detectExplicitHumanRequest("quiero un asesor")).toBe(true);
  });

  it("does not match ordinary messages", () => {
    expect(detectExplicitHumanRequest("hola, necesito ayuda con mi reserva")).toBe(
      false
    );
    expect(detectExplicitHumanRequest("el auto no prende")).toBe(false);
  });
});

describe("preLlmHandoffReason", () => {
  it("returns explicit_request when user asks for human", () => {
    expect(
      preLlmHandoffReason({
        text: "quiero un humano",
        state: makeState(),
        maxTurns: 8
      })
    ).toBe("explicit_request");
  });

  it("returns max_turns_reached when over the limit", () => {
    expect(
      preLlmHandoffReason({
        text: "sigo sin poder",
        state: makeState({ turns: 8 }),
        maxTurns: 8
      })
    ).toBe("max_turns_reached");
  });

  it("returns null when nothing applies", () => {
    expect(
      preLlmHandoffReason({
        text: "mi reserva dice error",
        state: makeState({ turns: 2 }),
        maxTurns: 8
      })
    ).toBeNull();
  });
});
