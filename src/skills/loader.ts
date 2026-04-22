import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type {
  Skill,
  SkillFrontmatter,
  SkillIndex,
  SkillIndexEntry
} from "./types.js";

export class SkillsLoader {
  private skills: Skill[] = [];

  constructor(private readonly skillsDir: string) {}

  async load(): Promise<void> {
    const indexPath = path.join(this.skillsDir, "index.json");
    const raw = await fs.readFile(indexPath, "utf8");
    const index = JSON.parse(raw) as SkillIndex;

    if (!Array.isArray(index.skills)) {
      throw new Error(`Skills index at ${indexPath} is malformed`);
    }

    const enabled = index.skills.filter((s) => s.enabled);
    const loaded = await Promise.all(
      enabled.map((entry) => this.loadSkill(entry))
    );
    this.skills = loaded;
  }

  private async loadSkill(entry: SkillIndexEntry): Promise<Skill> {
    const filePath = path.join(this.skillsDir, entry.file);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = matter(raw);
    const fm = parsed.data as SkillFrontmatter;

    return {
      id: fm.id ?? entry.id,
      title: fm.title ?? entry.title,
      description: fm.description ?? entry.description,
      category: fm.category ?? entry.category,
      askEmail: Boolean(fm.ask_email),
      body: parsed.content.trim()
    };
  }

  getAll(): Skill[] {
    return this.skills;
  }

  getById(id: string): Skill | undefined {
    return this.skills.find((s) => s.id === id);
  }
}
