import fs from "node:fs";
import path from "node:path";
import { parseSkillMarkdown } from "./parser.js";
import type { LoadedSkill, SkillIndex } from "./types.js";

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
    if (!entry?.id || !entry?.file) continue;
    if (entry.enabled === false) continue;

    const filePath = path.resolve(skillsDir, entry.file);
    if (!fs.existsSync(filePath)) continue;

    const raw = fs.readFileSync(filePath, "utf8");
    const skill = parseSkillMarkdown(raw, entry.file);

    loaded.push({
      id: skill.id,
      title: skill.title,
      description: skill.description ?? "",
      category: skill.category ?? null,
      askEmail: Boolean(skill.ask_email),
      triggers: skill.triggers ?? [],
      diagnosticQuestions: skill.diagnostic_questions ?? [],
      steps: skill.steps ?? [],
      escalateWhen: skill.escalate_when ?? [],
      constraints: skill.constraints ?? []
    });
  }

  return loaded;
}
