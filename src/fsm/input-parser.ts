import type { ConversationCategory, ParsedInput } from "./types.js";

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export function parseInput(content: string): ParsedInput {
  const normalized = normalize(content);

  if (isHandoffRequest(normalized)) {
    return {
      signal: "handoff",
      email: extractEmail(content),
      category: null
    };
  }

  if (isGoodbye(normalized)) {
    return {
      signal: "goodbye",
      email: null,
      category: null
    };
  }

  const email = extractEmail(content);
  if (email) {
    return {
      signal: "email",
      email,
      category: null
    };
  }

  const category = detectCategory(normalized);
  if (category) {
    return {
      signal: "category",
      email: null,
      category
    };
  }

  if (isYes(normalized)) {
    return { signal: "yes", email: null, category: null };
  }

  if (isNo(normalized)) {
    return { signal: "no", email: null, category: null };
  }

  if (normalized.length > 0) {
    return { signal: "text", email: null, category: null };
  }

  return { signal: "unknown", email: null, category: null };
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function extractEmail(value: string): string | null {
  const match = value.match(EMAIL_REGEX);
  if (!match) {
    return null;
  }
  return match[0].toLowerCase();
}

function isYes(value: string): boolean {
  return [/^(si|s|yes|y|ok|dale)$/, /^si\b/].some(pattern => pattern.test(value));
}

function isNo(value: string): boolean {
  return [/^(no|n)$/, /^no\b/, /\bno quiero\b/, /\bprefiero no\b/].some(pattern =>
    pattern.test(value)
  );
}

function isHandoffRequest(value: string): boolean {
  return /\b(humano|agente|asesor|persona|operador|representante|hablar con alguien)\b/.test(
    value
  );
}

function isGoodbye(value: string): boolean {
  return [
    /^(chau|chao|adios|bye|listo|gracias)\s*(chau|chao|adios|bye)?\s*$/,
    /\b(hasta luego|hasta la proxima|me despido|nos vemos)\b/
  ].some(pattern => pattern.test(value));
}

export function isMeaningfulProblemText(content: string): boolean {
  return content.trim().length >= 4;
}

export function detectCategory(normalized: string): ConversationCategory | null {
  if (!normalized) {
    return null;
  }

  if (/^2\)?$/.test(normalized) || /^opcion\s*2$/.test(normalized)) {
    return "tecnico";
  }
  if (/^3\)?$/.test(normalized) || /^opcion\s*3$/.test(normalized)) {
    return "administrativo";
  }
  if (/^4\)?$/.test(normalized) || /^opcion\s*4$/.test(normalized)) {
    return "general";
  }

  if (isShortCategoryAnswer(normalized)) {
    if (matchesTecnico(normalized)) return "tecnico";
    if (matchesAdministrativo(normalized)) return "administrativo";
    if (matchesGeneral(normalized)) return "general";
  }

  return null;
}

function isShortCategoryAnswer(value: string): boolean {
  return value.split(/\s+/).filter(Boolean).length <= 3;
}

function matchesTecnico(value: string): boolean {
  return /\b(tecnico|tec|soporte)\b/.test(value);
}

function matchesAdministrativo(value: string): boolean {
  return /\b(administrativo|admin|cobro|cobros|factura|facturacion|pago|pagos|cuenta|cuentas)\b/.test(
    value
  );
}

function matchesGeneral(value: string): boolean {
  return /\b(consulta|consultas|general|pregunta|preguntas|info|informacion|informativa|informativo|duda|dudas|otra|averiguar|averiguando|averigua|prospecto|no soy (?:usuario|cliente)|no tengo cuenta)\b/.test(
    value
  );
}
