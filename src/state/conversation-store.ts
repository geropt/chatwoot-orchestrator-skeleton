export type ConversationPhase =
  | "cold_start"
  | "active"
  | "awaiting_email"
  | "off_hours_intake"
  | "handoff_active";

export type HistoryEntry = {
  role: "user" | "assistant";
  content: string;
};

export type ConversationState = {
  phase: ConversationPhase;
  turns: number;
  history: HistoryEntry[];
  email?: string;
  matchedSkillId?: string;
  agentRetries: number;
  updatedAt: number;
};

export class ConversationStore {
  private readonly map = new Map<number, ConversationState>();

  get(conversationId: number): ConversationState {
    let state = this.map.get(conversationId);
    if (!state) {
      state = this.initialState();
      this.map.set(conversationId, state);
    }
    return state;
  }

  update(
    conversationId: number,
    patch: Partial<ConversationState>
  ): ConversationState {
    const current = this.get(conversationId);
    const next: ConversationState = {
      ...current,
      ...patch,
      updatedAt: Date.now()
    };
    this.map.set(conversationId, next);
    return next;
  }

  appendHistory(conversationId: number, entry: HistoryEntry): void {
    const state = this.get(conversationId);
    state.history.push(entry);
    state.updatedAt = Date.now();
  }

  reset(conversationId: number): void {
    this.map.set(conversationId, this.initialState());
  }

  private initialState(): ConversationState {
    return {
      phase: "cold_start",
      turns: 0,
      history: [],
      agentRetries: 0,
      updatedAt: Date.now()
    };
  }
}
