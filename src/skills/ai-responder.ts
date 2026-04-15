import type { AppConfig } from "../config.js";
import type { LoadedSkill } from "./types.js";

export async function buildSkillResponseWithAi(params: {
  query: string;
  skill: LoadedSkill;
  config: AppConfig;
}): Promise<string | null> {
  const { query, skill, config } = params;
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
        temperature: 0.3,
        max_tokens: 260,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Escribe una respuesta breve para soporte en espanol rioplatense. Usa SOLO la skill provista. No inventes politicas ni datos. Devuelve JSON estricto con {response}. La respuesta debe ser accionable, clara y menor al limite de caracteres indicado."
          },
          {
            role: "user",
            content: JSON.stringify({
              user_message: query,
              max_chars: config.aiSkillResponseMaxChars,
              skill: {
                id: skill.id,
                title: skill.title,
                guidance: skill.guidance,
                constraints: skill.constraints,
                fallback_response: skill.response
              }
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
    const raw = body.choices?.[0]?.message?.content;
    if (!raw) {
      return null;
    }

    const parsed = parseJsonObject(raw);
    const text = typeof parsed?.response === "string" ? parsed.response.trim() : "";
    if (!text) {
      return null;
    }

    return text.slice(0, config.aiSkillResponseMaxChars);
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
