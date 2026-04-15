import type { AppConfig } from "../config.js";

export type FaqConfirmationLabel = "yes" | "no" | "unknown";

export type AiFaqConfirmationResult = {
  label: FaqConfirmationLabel;
  confidence: number;
  reason: string;
};

export async function classifyFaqConfirmationWithAi(params: {
  content: string;
  config: AppConfig;
}): Promise<AiFaqConfirmationResult | null> {
  const { content, config } = params;
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
        max_tokens: 140,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You classify if a user confirmed an FAQ helped. Return strict JSON with keys: label, confidence, reason. label must be one of: yes, no, unknown. confidence must be between 0 and 1. Use unknown when unclear."
          },
          {
            role: "user",
            content: content
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
    if (!parsed) {
      return null;
    }

    const labelRaw = parsed.label;
    const label =
      labelRaw === "yes" || labelRaw === "no" || labelRaw === "unknown"
        ? labelRaw
        : null;
    if (!label) {
      return null;
    }

    const confidenceRaw = Number(parsed.confidence);
    if (Number.isNaN(confidenceRaw)) {
      return null;
    }

    return {
      label,
      confidence: Math.max(0, Math.min(1, confidenceRaw)),
      reason: typeof parsed.reason === "string" ? parsed.reason : ""
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
