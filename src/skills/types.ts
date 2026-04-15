export type SkillIndexEntry = {
  id: string;
  file: string;
  enabled?: boolean;
};

export type SkillIndex = {
  version: number;
  skills: SkillIndexEntry[];
};

export type SkillDocument = {
  id: string;
  title: string;
  patterns: string[];
  response?: string;
  guidance?: string[];
  constraints?: string[];
  ask_email?: boolean;
};

export type LoadedSkill = {
  id: string;
  title: string;
  patterns: string[];
  response: string;
  guidance: string[];
  constraints: string[];
  askEmail: boolean;
};

export type AiSkillSelection = {
  selectedSkillId: string | null;
  confidence: number;
  reason: string;
};
