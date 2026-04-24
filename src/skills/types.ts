export type SkillCategory = "tecnico" | "administrativo" | "general" | "comercial";

export type SkillFrontmatter = {
  id: string;
  title: string;
  description: string;
  category: SkillCategory;
  ask_email?: boolean;
};

export type SkillIndexEntry = {
  id: string;
  file: string;
  title: string;
  description: string;
  category: SkillCategory;
  enabled: boolean;
};

export type SkillIndex = {
  version: number;
  generated_at: string;
  skills: SkillIndexEntry[];
};

export type Skill = {
  id: string;
  title: string;
  description: string;
  category: SkillCategory;
  askEmail: boolean;
  body: string;
};
