import type { TemplateKey } from "./types.js";

const TEMPLATES: Record<TemplateKey, string> = {
  ASK_TRIP_ACTION:
    "¿Qué necesitás?\n\n1) Reportar daños al vehículo\n2) Tengo una emergencia",
  WELCOME_TRIAGE:
    "¡Hola! Soy el asistente de MyKeego. Para poder ayudarte, decime de qué se trata:\n\n0) Estoy en un viaje en curso\n1) Tengo un problema (app o reserva)\n2) Administrativo (cobros, cuenta, documentación)\n3) Consulta informativa (todavía no soy usuario)\n\nRespondé con el número o contame directamente qué necesitás.",
  ASK_CATEGORY_RETRY:
    "Para orientarte mejor, ¿es un tema técnico, administrativo o una consulta informativa (no sos usuario todavía)? También podés contarme qué te pasa y yo lo clasifico.",
  ASK_EMAIL:
    "Compartime tu email de contacto así dejo el caso vinculado a tu cuenta.",
  ASK_EMAIL_RETRY:
    "No pude leer un email válido. Mandámelo con formato nombre@dominio.com.",
  FAREWELL:
    "Perfecto, cualquier cosa escribinos y seguimos. ¡Buen día!",
  HANDOFF_HUMAN:
    "Te conecto con un operador para que siga con tu caso.",
  GENERAL_HANDOFF:
    "Te derivo con un operador para que atienda tu consulta.",
  OUT_OF_HOURS_HANDOFF:
    "Ahora estamos fuera de horario de atención. Dejé tu caso en cola y un operador te responde apenas vuelva el equipo.",
  AGENT_TECHNICAL_RETRY:
    "Uh, se me cruzó un cable al procesar tu mensaje. ¿Me lo repetís?"
};

export function renderTemplate(key: TemplateKey): string {
  return TEMPLATES[key];
}
