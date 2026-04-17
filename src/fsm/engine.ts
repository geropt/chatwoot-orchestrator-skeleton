import type {
  ConversationCategory,
  ConversationPriority,
  ConversationState,
  FsmDecision,
  HandoffSummary,
  TemplateKey,
  UserSignal
} from "./types.js";

export function buildReplyDecision(params: {
  currentState: ConversationState;
  replyKey: TemplateKey | null;
  replyText: string | null;
  nextState: ConversationState["state"];
  signal: UserSignal;
  unknownAttempts: number;
  category?: ConversationCategory | null;
  email?: string | null;
  problem?: string | null;
  matchedSkillId?: string | null;
}): FsmDecision {
  return {
    action: "reply",
    replyKey: params.replyKey,
    replyText: params.replyText,
    nextState: params.nextState,
    unknownAttempts: params.unknownAttempts,
    signal: params.signal,
    email: params.email === undefined ? params.currentState.email : params.email,
    problem:
      params.problem === undefined ? params.currentState.problem : params.problem,
    matchedSkillId:
      params.matchedSkillId === undefined
        ? params.currentState.matchedSkillId
        : params.matchedSkillId,
    category:
      params.category === undefined ? params.currentState.category : params.category,
    addAgentNote: false,
    agentSummary: null,
    agentHandoffSummary: null,
    priority: null
  };
}

export function buildHandoffDecision(params: {
  currentState: ConversationState;
  signal: UserSignal;
  replyKey: TemplateKey;
  replyText: string | null;
  problem: string | null;
  matchedSkillId?: string | null;
  category?: ConversationCategory | null;
  addAgentNote?: boolean;
  agentSummary?: string | null;
  agentHandoffSummary?: HandoffSummary | null;
  priority?: ConversationPriority | null;
}): FsmDecision {
  return {
    action: "handoff",
    replyKey: params.replyKey,
    replyText: params.replyText,
    nextState: "handoff_active",
    unknownAttempts: 0,
    signal: params.signal,
    email: params.currentState.email,
    problem: params.problem,
    matchedSkillId:
      params.matchedSkillId === undefined
        ? params.currentState.matchedSkillId
        : params.matchedSkillId,
    category:
      params.category === undefined ? params.currentState.category : params.category,
    addAgentNote: params.addAgentNote ?? true,
    agentSummary: params.agentSummary ?? null,
    agentHandoffSummary: params.agentHandoffSummary ?? null,
    priority: params.priority ?? null
  };
}

export function buildFarewellDecision(
  currentState: ConversationState
): FsmDecision {
  return buildReplyDecision({
    currentState,
    replyKey: "FAREWELL",
    replyText: null,
    nextState: "cold_start",
    signal: "goodbye",
    unknownAttempts: 0,
    category: null,
    problem: null,
    matchedSkillId: null
  });
}

export function isConversationPriority(
  value: unknown
): value is ConversationPriority {
  return (
    value === "urgent" ||
    value === "high" ||
    value === "medium" ||
    value === "low"
  );
}
