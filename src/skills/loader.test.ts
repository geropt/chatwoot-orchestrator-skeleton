import path from "node:path";
import { describe, expect, it } from "vitest";
import { SkillsLoader } from "./loader.js";

const skillsDir = path.resolve(process.cwd(), "skills");

describe("SkillsLoader", () => {
  it("loads all enabled skills from the real skills directory", async () => {
    const loader = new SkillsLoader(skillsDir);
    await loader.load();
    const all = loader.getAll();
    expect(all.length).toBeGreaterThan(0);
    for (const skill of all) {
      expect(skill.id).toBeTruthy();
      expect(skill.title).toBeTruthy();
      expect(skill.body).toBeTruthy();
      expect(["tecnico", "administrativo", "general"]).toContain(skill.category);
    }
  });

  it("resolves by id", async () => {
    const loader = new SkillsLoader(skillsDir);
    await loader.load();
    const skill = loader.getById("auxilio_mecanico_aca");
    expect(skill?.askEmail).toBe(true);
  });
});
