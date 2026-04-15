import type { AppConfig } from "../config.js";
import type { SkillMatch } from "../fsm/types.js";
import type { AiSkillSelection } from "./types.js";

export async function selectSkillWithAi(params: {
  query: string;
  candidates: SkillMatch[];
  config: AppConfig;
}): Promise<AiSkillSelection | null> {
  const { query, candidates, config } = params;
  if (!candidates.length) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.openrouterTimeoutMs);

  try {
    const response = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openrouterApiKey}`
      },
      body: JSON.stringify({
        model: config.openrouterModel,
        temperature: 0,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You route a customer issue to one FAQ skill candidate. Return strict JSON with keys selected_skill_id, confidence, reason. selected_skill_id must be one of the provided candidate ids or null. confidence must be between 0 and 1. If none are clearly relevant, return null."
          },
          {
            role: "user",
            content: JSON.stringify({
              issue: query,
              candidates: candidates.map(candidate => ({
                id: candidate.id,
                title: candidate.title,
                score: candidate.score,
                patterns: candidate.patterns.slice(0, 5),
                guidance: candidate.guidance.slice(0, 4)
              }))
            })
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }

    const parsed = parseJsonObject(content);
    if (!parsed) {
      return null;
    }

    const candidateIds = new Set(candidates.map(candidate => candidate.id));
    const selectedRaw = parsed.selected_skill_id;
    const selectedSkillId =
      selectedRaw === null
        ? null
        : typeof selectedRaw === "string" && candidateIds.has(selectedRaw)
          ? selectedRaw
          : null;

    const confidenceRaw = Number(parsed.confidence);
    if (Number.isNaN(confidenceRaw)) {
      return null;
    }

    const reason = typeof parsed.reason === "string" ? parsed.reason : "";

    return {
      selectedSkillId,
      confidence: Math.max(0, Math.min(1, confidenceRaw)),
      reason
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const direct = safeParse(content);
  if (direct) {
    return direct;
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return safeParse(content.slice(start, end + 1));
}

function safeParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
