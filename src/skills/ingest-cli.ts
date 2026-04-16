import fs from "node:fs";
import path from "node:path";
import { parseSkillMarkdown } from "./parser.js";
import type { SkillIndex, SkillIndexEntry } from "./types.js";

function main(): void {
  const skillsDirArg = process.argv[2];
  const skillsDir = path.resolve(skillsDirArg || process.env.SKILLS_DIR || "./skills");

  if (!fs.existsSync(skillsDir)) {
    throw new Error(`Skills directory not found: ${skillsDir}`);
  }

  const files = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".md"))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const indexEntries: SkillIndexEntry[] = [];
  const seenIds = new Set<string>();

  for (const file of files) {
    const filePath = path.resolve(skillsDir, file);
    const raw = fs.readFileSync(filePath, "utf8");
    const skill = parseSkillMarkdown(raw, file);

    if (seenIds.has(skill.id)) {
      throw new Error(`Duplicate skill id detected: ${skill.id}`);
    }
    seenIds.add(skill.id);

    indexEntries.push({
      id: skill.id,
      file,
      title: skill.title,
      ...(skill.description ? { description: skill.description } : {}),
      ...(skill.category ? { category: skill.category } : {}),
      enabled: true
    });
  }

  indexEntries.sort((a, b) => a.id.localeCompare(b.id));

  const index: SkillIndex = {
    version: 4,
    generated_at: new Date().toISOString(),
    skills: indexEntries
  };

  fs.writeFileSync(
    path.resolve(skillsDir, "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8"
  );

  process.stdout.write(`Skills indexed: ${indexEntries.length} (${skillsDir})\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
