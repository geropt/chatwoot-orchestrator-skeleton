import type { ConversationState } from "./types.js";

const DEFAULT_STATE: ConversationState = {
  state: "cold_start",
  unknownAttempts: 0,
  email: null,
  problem: null,
  matchedSkillId: null,
  category: null,
  history: [],
  updatedAt: Date.now()
};

export class ConversationStateStore {
  private readonly store = new Map<number, ConversationState>();

  get(conversationId: number): ConversationState {
    const state = this.store.get(conversationId);
    if (!state) {
      return { ...DEFAULT_STATE, history: [], updatedAt: Date.now() };
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
