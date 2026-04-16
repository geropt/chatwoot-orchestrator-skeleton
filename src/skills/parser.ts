import matter from "gray-matter";
import type { ConversationCategory } from "../fsm/types.js";
import type { SkillDocument } from "./types.js";

type SectionKey =
  | "triggers"
  | "diagnostic_questions"
  | "steps"
  | "escalate_when"
  | "constraints";

const SECTION_ALIASES: Record<string, SectionKey> = {
  "cuando aplica": "triggers",
  "triggers": "triggers",
  "preguntas diagnosticas": "diagnostic_questions",
  "preguntas": "diagnostic_questions",
  "diagnostico": "diagnostic_questions",
  "pasos a guiar": "steps",
  "pasos": "steps",
  "procedimiento": "steps",
  "cuando derivar": "escalate_when",
  "cuando derivar a operador": "escalate_when",
  "escalar": "escalate_when",
  "handoff": "escalate_when",
  "restricciones": "constraints",
  "constraints": "constraints"
};

export function parseSkillMarkdown(raw: string, fileName: string): SkillDocument {
  const parsed = matter(raw);
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  const sections = parseSections(parsed.content);

  const id = requireString(data.id, "id", fileName);
  const title = requireString(data.title, "title", fileName);
  const category = normalizeCategory(data.category, fileName);
  const description = optionalString(data.description);
  const askEmail = Boolean(data.ask_email);

  return {
    id,
    title,
    ...(description ? { description } : {}),
    ...(category ? { category } : {}),
    ask_email: askEmail,
    triggers: sections.triggers ?? [],
    diagnostic_questions: sections.diagnostic_questions ?? [],
    steps: sections.steps ?? [],
    escalate_when: sections.escalate_when ?? [],
    constraints: sections.constraints ?? []
  };
}

function parseSections(body: string): Partial<Record<SectionKey, string[]>> {
  const result: Partial<Record<SectionKey, string[]>> = {};
  const lines = body.split("\n");
  let currentKey: SectionKey | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (currentKey && buffer.length) {
      const items = extractBullets(buffer);
      if (items.length) {
        result[currentKey] = items;
      }
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flush();
      const label = normalize(heading[1]);
      currentKey = SECTION_ALIASES[label] ?? null;
      continue;
    }
    if (currentKey) {
      buffer.push(line);
    }
  }
  flush();

  return result;
}

function extractBullets(lines: string[]): string[] {
  const items: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^(?:[-*]\s+|\d+[.)]\s+)(.+)$/);
    if (bullet) {
      items.push(bullet[1].trim());
    }
  }
  return items;
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function requireString(value: unknown, field: string, file: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Skill ${file} is missing required field '${field}'`);
  }
  return value.trim();
}

function optionalString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeCategory(
  value: unknown,
  file: string
): ConversationCategory | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "tecnico" || value === "administrativo" || value === "general") {
    return value;
  }
  throw new Error(`Skill ${file} has invalid category '${String(value)}'`);
}
