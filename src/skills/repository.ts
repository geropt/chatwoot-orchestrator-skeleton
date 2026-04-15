import fs from "node:fs";
import path from "node:path";
import type { LoadedSkill, SkillDocument, SkillIndex } from "./types.js";

export function loadSkills(skillsDir: string): LoadedSkill[] {
  const indexPath = path.resolve(skillsDir, "index.json");
  if (!fs.existsSync(indexPath)) {
    return [];
  }

  const indexRaw = fs.readFileSync(indexPath, "utf8");
  const indexJson = JSON.parse(indexRaw) as SkillIndex;
  if (!Array.isArray(indexJson.skills)) {
    return [];
  }

  const loaded: LoadedSkill[] = [];

  for (const entry of indexJson.skills) {
    if (!entry?.id || !entry?.file) {
      continue;
    }

    if (entry.enabled === false) {
      continue;
    }

    const filePath = path.resolve(skillsDir, entry.file);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const skillRaw = fs.readFileSync(filePath, "utf8");
    const skill = JSON.parse(skillRaw) as SkillDocument;

    if (!skill.id || !skill.title || !Array.isArray(skill.patterns)) {
      continue;
    }

    const guidance = normalizeStringArray(skill.guidance);
    const constraints = normalizeStringArray(skill.constraints);
    const response =
      typeof skill.response === "string" && skill.response.trim()
        ? skill.response.trim()
        : buildFallbackResponse(guidance);

    if (!response) {
      continue;
    }

    loaded.push({
      id: skill.id,
      title: skill.title,
      response,
      patterns: skill.patterns,
      guidance,
      constraints,
      askEmail: Boolean(skill.ask_email)
    });
  }

  return loaded;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function buildFallbackResponse(guidance: string[]): string {
  if (!guidance.length) {
    return "";
  }

  const steps = guidance
    .slice(0, 4)
    .map((item, index) => `${index + 1}) ${item}`)
    .join(" ");

  return `Entiendo. Te propongo probar esto: ${steps}`;
}
