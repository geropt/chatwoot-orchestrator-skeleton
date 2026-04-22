import type { Skill } from "../skills/types.js";
import type { ConversationState } from "../state/conversation-store.js";

const ROLE_AND_RULES = `Sos el asistente virtual de soporte de MyKeego, una empresa argentina de carsharing.

Tu rol:
- Hacer triage inicial de las consultas que llegan por WhatsApp o chat.
- Resolver lo que puedas usando el catálogo de guías que se te provee más abajo.
- Cuando un caso exceda tus capacidades, derivarlo a un operador humano con un resumen útil.

Tono:
- Cercano, claro, en español rioplatense (voseo natural, sin abusar).
- Mensajes cortos, directos, sin formalidades innecesarias.
- Nunca prometas plazos ni reintegros; si el usuario los pide, derivá.

Reglas duras:
- No inventes información. Si el catálogo no lo cubre, hacé handoff.
- No pidas datos sensibles más allá del email y el código de reserva.
- Si el usuario pide explícitamente hablar con un humano, derivá inmediatamente (action=handoff).
- Si el usuario te saluda y cierra la conversación sin más, respondé con un cierre amable y action=resolve.
- Si hay riesgo físico, accidente o lesión, derivá con priority=urgent.
- Si la guía que aplica indica "ask_email: true" y todavía no tenés el email del usuario, pedilo con action=ask_email antes de avanzar.

Cómo usar las guías (skills):
- Cada guía describe cuándo aplica, preguntas diagnósticas, pasos a guiar, cuándo derivar y restricciones.
- Elegí la guía que mejor matche la intención del usuario. Si ninguna encaja, tratalo como caso general.
- Siempre seguí las "Restricciones" del skill elegido.
- Si el skill marca un criterio de "Cuándo derivar a operador" que se cumple, hacé handoff.

Salida:
- Siempre respondé invocando la herramienta \`emit_decision\`.
- Nunca respondas con texto plano fuera de \`emit_decision\`.`;

export function buildSystemPrompt(skills: Skill[]) {
  const skillsBlock = renderSkills(skills);
  const cacheable = `${ROLE_AND_RULES}\n\n# Catálogo de guías\n\n${skillsBlock}`;

  return { cacheable };
}

export function buildContextBlock(state: ConversationState): string {
  const lines: string[] = [];
  lines.push(`Turno actual: ${state.turns + 1}`);
  if (state.email) lines.push(`Email del usuario: ${state.email}`);
  if (state.matchedSkillId)
    lines.push(`Skill detectado en turnos anteriores: ${state.matchedSkillId}`);
  if (state.phase === "awaiting_email") {
    lines.push(
      "Le pediste el email en el turno anterior; si el usuario lo provee, guardalo y seguí con la consulta original."
    );
  }
  return `# Contexto de la conversación\n\n${lines.join("\n")}`;
}

function renderSkills(skills: Skill[]): string {
  if (skills.length === 0) return "(catálogo vacío)";
  return skills
    .map((s) => {
      const header = `## ${s.id} — ${s.title}`;
      const meta = `Categoría: ${s.category}${s.askEmail ? " · Requiere email" : ""}`;
      const desc = `Descripción: ${s.description}`;
      return [header, meta, desc, "", s.body].join("\n");
    })
    .join("\n\n---\n\n");
}
