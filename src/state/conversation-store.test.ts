import { describe, expect, it } from "vitest";
import { ConversationStore } from "./conversation-store.js";
import { DedupeStore } from "./dedupe-store.js";

describe("ConversationStore", () => {
  it("initializes a fresh state on first access", () => {
    const store = new ConversationStore();
    const state = store.get(1);
    expect(state.phase).toBe("cold_start");
    expect(state.turns).toBe(0);
    expect(state.history).toEqual([]);
  });

  it("appends history and updates turns", () => {
    const store = new ConversationStore();
    store.appendHistory(1, { role: "user", content: "hola" });
    store.update(1, { turns: 1 });
    const state = store.get(1);
    expect(state.turns).toBe(1);
    expect(state.history).toHaveLength(1);
  });

  it("resets state to cold_start", () => {
    const store = new ConversationStore();
    store.update(1, { phase: "handoff_active", turns: 5 });
    store.reset(1);
    expect(store.get(1).phase).toBe("cold_start");
    expect(store.get(1).turns).toBe(0);
  });
});

describe("DedupeStore", () => {
  it("returns false on first sight and true thereafter", () => {
    const store = new DedupeStore();
    expect(store.seenRecently("a")).toBe(false);
    expect(store.seenRecently("a")).toBe(true);
    expect(store.seenRecently("b")).toBe(false);
  });

  it("expires entries past the TTL", async () => {
    const store = new DedupeStore(10);
    store.seenRecently("a");
    await new Promise((r) => setTimeout(r, 20));
    expect(store.seenRecently("a")).toBe(false);
  });
});
