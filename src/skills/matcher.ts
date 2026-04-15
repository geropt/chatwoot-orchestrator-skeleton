import type { SkillMatch } from "../fsm/types.js";
import type { LoadedSkill } from "./types.js";

const DEFAULT_MIN_SKILL_SCORE = 0.45;

export function matchSkill(
  query: string,
  skills: LoadedSkill[],
  minScore = DEFAULT_MIN_SKILL_SCORE
): SkillMatch | null {
  const ranked = rankSkills(query, skills);
  const best = ranked[0];
  if (!best || best.score < minScore) {
    return null;
  }
  return best;
}

export function rankSkills(query: string, skills: LoadedSkill[]): SkillMatch[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return [];
  }

  const matches: SkillMatch[] = [];

  for (const skill of skills) {
    const score = getSkillScore(normalizedQuery, skill.patterns);
    if (score <= 0) {
      continue;
    }

    matches.push({
      id: skill.id,
      title: skill.title,
      response: skill.response,
      guidance: skill.guidance,
      patterns: skill.patterns,
      askEmail: skill.askEmail,
      score
    });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}

function getSkillScore(query: string, patterns: string[]): number {
  let bestScore = 0;

  for (const pattern of patterns) {
    const normalizedPattern = normalize(pattern);
    if (!normalizedPattern) {
      continue;
    }

    if (query.includes(normalizedPattern)) {
      return 1;
    }

    const nearExactScore = nearExactTokenMatchScore(query, normalizedPattern);
    if (nearExactScore > bestScore) {
      bestScore = nearExactScore;
    }

    const score = tokenOverlapScore(query, normalizedPattern);
    if (score > bestScore) {
      bestScore = score;
    }
  }

  return bestScore;
}

function nearExactTokenMatchScore(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (!aTokens.size || !bTokens.size) {
    return 0;
  }

  let common = 0;
  for (const token of bTokens) {
    if (aTokens.has(token)) {
      common += 1;
    }
  }

  if (common >= Math.max(1, bTokens.size - 1)) {
    return 0.95;
  }

  return 0;
}

function tokenOverlapScore(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (!aTokens.size || !bTokens.size) {
    return 0;
  }

  let common = 0;
  for (const token of bTokens) {
    if (aTokens.has(token)) {
      common += 1;
    }
  }

  const recall = common / bTokens.size;
  const precision = common / aTokens.size;
  return Math.max(recall, precision * 0.9);
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .split(/\s+/)
      .map(stemToken)
      .filter(token => token.length >= 2)
  );
}

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("es")) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
