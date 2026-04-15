import type { ParsedInput } from "./types.js";

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export function parseInput(content: string): ParsedInput {
  const normalized = normalize(content);

  if (isHandoffRequest(normalized)) {
    return {
      signal: "handoff",
      email: extractEmail(content)
    };
  }

  const email = extractEmail(content);
  if (email) {
    return {
      signal: "email",
      email
    };
  }

  if (isYes(normalized)) {
    return {
      signal: "yes",
      email: null
    };
  }

  if (isNo(normalized)) {
    return {
      signal: "no",
      email: null
    };
  }

  if (normalized.length > 0) {
    return {
      signal: "text",
      email: null
    };
  }

  return {
    signal: "unknown",
    email: null
  };
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
  return [
    /^(si|s|yes|y)$/,
    /^si\b/,
    /\bsoy cliente\b/,
    /\bsoy usuario\b/,
    /^cliente$/
  ].some(pattern => pattern.test(value));
}

function isNo(value: string): boolean {
  return [
    /^(no|n)$/,
    /^no\b/,
    /\bno soy usuario\b/,
    /\bno soy cliente\b/,
    /\bte dije que no\b/,
    /\bno quiero\b/,
    /\bprefiero no\b/,
    /\bsin mail\b/
  ].some(pattern => pattern.test(value));
}

function isHandoffRequest(value: string): boolean {
  return /\b(humano|agente|asesor|persona|operador|representante)\b/.test(value);
}

export function isMeaningfulProblemText(content: string): boolean {
  return content.trim().length >= 8;
}

export function detectAffirmation(content: string): "yes" | "no" | null {
  const normalized = normalize(content);
  if (!normalized) {
    return null;
  }

  if (isStrongYes(normalized)) {
    return "yes";
  }

  if (isStrongNo(normalized)) {
    return "no";
  }

  return null;
}

function isStrongYes(value: string): boolean {
  return [
    /\b(si|yes|ok|dale)\b/,
    /\b(funciono|sirvio|resuelto|solucionado)\b/,
    /\b(ya esta|ya quedo|quedo andando)\b/
  ].some(pattern => pattern.test(value));
}

function isStrongNo(value: string): boolean {
  return [
    /^no$/, 
    /\b(no funciona|no funciono|no sirvio|sigue igual)\b/,
    /\b(no abre|no anda|no responde|no arranca)\b/,
    /\b(probe de todo pero no)\b/,
    /\b(no pude|sin cambios)\b/
  ].some(pattern => pattern.test(value));
}
