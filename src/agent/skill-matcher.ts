import type { ConversationCategory } from "../fsm/types.js";
import type { LoadedSkill } from "../skills/types.js";

export async function preMatchSkill(params: {
  message: string;
  skills: LoadedSkill[];
  category: ConversationCategory | null;
  openrouterBaseUrl: string;
  openrouterApiKey: string;
  matcherModel: string;
  timeoutMs: number;
}): Promise<string | null> {
  const { message, skills, category, openrouterBaseUrl, openrouterApiKey, matcherModel, timeoutMs } = params;

  const candidates = filterByCategory(skills, category);
  if (!candidates.length) return null;

  const catalog = candidates
    .map(s => {
      const lines = [`id: ${s.id}`, `titulo: ${s.title}`];
      if (s.description) lines.push(`descripcion: ${s.description}`);
      if (s.triggers.length) lines.push(`cuando aplica: ${s.triggers.join(" | ")}`);
      return lines.join(", ");
    })
    .join("\n");

  const prompt = [
    "Sos un clasificador. Dado el mensaje de un usuario y una lista de skills de soporte, devolvé ÚNICAMENTE el id del skill que mejor aplica.",
    "Si ninguno aplica claramente, devolvé: null",
    "No escribas nada más que el id o la palabra null.",
    "",
    "Skills disponibles:",
    catalog,
    "",
    `Mensaje del usuario: ${message}`
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${openrouterBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openrouterApiKey}`
      },
      body: JSON.stringify({
        model: matcherModel,
        temperature: 0,
        max_tokens: 32,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: controller.signal
    });

    if (!response.ok) return null;

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const raw = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw || raw === "null") return null;

    const matched = candidates.find(s => s.id === raw);
    return matched ? matched.id : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function filterByCategory(
  skills: LoadedSkill[],
  category: ConversationCategory | null
): LoadedSkill[] {
  if (category === "general") return skills;
  if (category === null) return skills.filter(s => s.category !== "general");
  return skills.filter(s => s.category === null || s.category === category);
}
