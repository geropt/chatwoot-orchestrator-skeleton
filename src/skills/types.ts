import type { ConversationCategory } from "../fsm/types.js";

export type SkillIndexEntry = {
  id: string;
  file: string;
  title?: string;
  description?: string;
  category?: ConversationCategory;
  enabled?: boolean;
};

export type SkillIndex = {
  version: number;
  generated_at?: string;
  skills: SkillIndexEntry[];
};

export type SkillDocument = {
  id: string;
  title: string;
  description?: string;
  category?: ConversationCategory;
  ask_email?: boolean;
  triggers?: string[];
  diagnostic_questions?: string[];
  steps?: string[];
  escalate_when?: string[];
  constraints?: string[];
};

export type LoadedSkill = {
  id: string;
  title: string;
  description: string;
  category: ConversationCategory | null;
  askEmail: boolean;
  triggers: string[];
  diagnosticQuestions: string[];
  steps: string[];
  escalateWhen: string[];
  constraints: string[];
};
