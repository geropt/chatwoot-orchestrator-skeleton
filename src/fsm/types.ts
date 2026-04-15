export type ConversationStateName =
  | "cold_start"
  | "handoff_active"
  | "awaiting_email"
  | "awaiting_problem"
  | "awaiting_faq_confirmation";

export type ConversationState = {
  state: ConversationStateName;
  unknownAttempts: number;
  isUser: boolean | null;
  email: string | null;
  problem: string | null;
  matchedSkillId: string | null;
  updatedAt: number;
};

export type UserSignal =
  | "handoff"
  | "yes"
  | "no"
  | "email"
  | "text"
  | "unknown";

export type TemplateKey =
  | "WELCOME_OPEN"
  | "ASK_EMAIL_FOR_CASE"
  | "ASK_EMAIL"
  | "ASK_EMAIL_RETRY"
  | "ASK_PROBLEM"
  | "ASK_PROBLEM_NO_EMAIL"
  | "ASK_PROBLEM_RETRY"
  | "FAQ_HELPED"
  | "FAQ_CONFIRM_RETRY"
  | "HANDOFF_HUMAN";

export type ParsedInput = {
  signal: UserSignal;
  email: string | null;
};

export type FsmDecision = {
  action: "reply" | "handoff";
  replyKey: TemplateKey;
  replyText: string | null;
  nextState: ConversationStateName;
  unknownAttempts: number;
  signal: UserSignal;
  isUser: boolean | null;
  email: string | null;
  problem: string | null;
  matchedSkillId: string | null;
  addAgentNote: boolean;
};

export type SkillMatch = {
  id: string;
  title: string;
  response: string;
  guidance: string[];
  patterns: string[];
  askEmail: boolean;
  score: number;
};
