import type { ConversationState } from "./types.js";

const DEFAULT_STATE: ConversationState = {
  state: "cold_start",
  unknownAttempts: 0,
  isUser: null,
  email: null,
  problem: null,
  matchedSkillId: null,
  updatedAt: Date.now()
};

export class ConversationStateStore {
  private readonly store = new Map<number, ConversationState>();

  get(conversationId: number): ConversationState {
    const state = this.store.get(conversationId);
    if (!state) {
      return { ...DEFAULT_STATE, updatedAt: Date.now() };
    }
    return state;
  }

  set(conversationId: number, state: ConversationState): void {
    this.store.set(conversationId, {
      ...state,
      updatedAt: Date.now()
    });
  }
}
