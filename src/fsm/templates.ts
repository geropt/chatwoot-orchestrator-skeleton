import type { TemplateKey } from "./types.js";

const TEMPLATES: Record<TemplateKey, string> = {
  WELCOME_OPEN: "Hola, gracias por escribirnos. Contame en que te podemos ayudar.",
  ASK_EMAIL_FOR_CASE:
    "Para ubicar mejor tu caso, compartime un mail de contacto. Si no queres compartirlo, seguimos igual.",
  ASK_EMAIL:
    "Perfecto. Pasame tu mail de contacto y seguimos con tu caso.",
  ASK_EMAIL_RETRY:
    "No pude detectar un mail valido. Si queres enviarlo, compartilo en formato nombre@dominio.com. Si no, seguimos igual.",
  ASK_PROBLEM:
    "Gracias. Ahora contame brevemente en que te podemos ayudar mientras contactamos a un operador.",
  ASK_PROBLEM_NO_EMAIL:
    "Perfecto, seguimos sin mail. Contame brevemente en que te podemos ayudar y te ayudo a derivarlo.",
  ASK_PROBLEM_RETRY:
    "Necesito una breve descripcion de tu consulta para pasarsela al operador.",
  FAQ_HELPED:
    "¿Esto te ayudo a resolverlo? Responde si o no para seguir.",
  FAQ_CONFIRM_RETRY:
    "Para cerrar este paso, responde si o no. Si queres, tambien te puedo derivar con una persona.",
  HANDOFF_HUMAN: "Te paso con un agente humano para ayudarte mejor."
};

export function renderTemplate(key: TemplateKey): string {
  return TEMPLATES[key];
}
