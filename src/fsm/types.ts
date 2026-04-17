export type ConversationStateName =
  | "cold_start"
  | "awaiting_trip_action"
  | "awaiting_category"
  | "agent_active"
  | "awaiting_email"
  | "handoff_active";

export type ConversationCategory = "tecnico" | "administrativo" | "general";

export type ConversationPriority = "urgent" | "high" | "medium" | "low";

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

export type HandoffSummary = {
  problem: string;
  attempted: string | null;
  reason: string;
};

export type ConversationState = {
  state: ConversationStateName;
  unknownAttempts: number;
  email: string | null;
  problem: string | null;
  matchedSkillId: string | null;
  category: ConversationCategory | null;
  history: ConversationTurn[];
  priorContext: string | null;
  updatedAt: number;
};

export type UserSignal =
  | "handoff"
  | "goodbye"
  | "yes"
  | "no"
  | "email"
  | "category"
  | "text"
  | "unknown";

export type TemplateKey =
  | "ASK_TRIP_ACTION"
  | "WELCOME_TRIAGE"
  | "ASK_CATEGORY_RETRY"
  | "ASK_EMAIL"
  | "ASK_EMAIL_RETRY"
  | "FAREWELL"
  | "HANDOFF_HUMAN"
  | "GENERAL_HANDOFF"
  | "OUT_OF_HOURS_HANDOFF"
  | "AGENT_TECHNICAL_RETRY";

export type ParsedInput = {
  signal: UserSignal;
  email: string | null;
  category: ConversationCategory | null;
};

export type FsmDecision = {
  action: "reply" | "handoff";
  replyKey: TemplateKey | null;
  replyText: string | null;
  nextState: ConversationStateName;
  unknownAttempts: number;
  signal: UserSignal;
  email: string | null;
  problem: string | null;
  matchedSkillId: string | null;
  category: ConversationCategory | null;
  addAgentNote: boolean;
  agentSummary: string | null;
  agentHandoffSummary: HandoffSummary | null;
  priority: ConversationPriority | null;
};
