import { describe, expect, it } from "vitest";
import { parseDecision } from "./decision.js";

describe("parseDecision", () => {
  it("accepts a minimal reply", () => {
    const d = parseDecision({ action: "reply", text: "hola" });
    expect(d.action).toBe("reply");
    expect(d.text).toBe("hola");
  });

  it("rejects missing text", () => {
    expect(() => parseDecision({ action: "reply" })).toThrow();
  });

  it("requires summary on handoff", () => {
    expect(() => parseDecision({ action: "handoff", text: "te derivo" })).toThrow();
    const d = parseDecision({
      action: "handoff",
      text: "te derivo",
      summary: "usuario con siniestro"
    });
    expect(d.summary).toBe("usuario con siniestro");
  });

  it("rejects unknown action", () => {
    expect(() => parseDecision({ action: "weird", text: "hi" })).toThrow();
  });
});
