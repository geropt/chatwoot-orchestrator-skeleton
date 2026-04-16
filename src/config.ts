export type AppConfig = {
  port: number;
  logLevel: string;
  chatwootBaseUrl: string;
  chatwootAccountId: number;
  chatwootApiToken: string;
  chatwootWebhookSecret: string;
  skipSignatureVerification: boolean;
  skillsDir: string;
  agentEnabled: boolean;
  agentTemperature: number;
  agentMaxTokens: number;
  agentHistoryLimit: number;
  agentMaxRetries: number;
  openrouterBaseUrl: string;
  openrouterApiKey: string;
  openrouterModel: string;
  openrouterTimeoutMs: number;
  businessHoursEnabled: boolean;
  businessTimezone: string;
  businessWorkingDays: number[];
  businessStartMinutes: number;
  businessEndMinutes: number;
  businessHoursLabel: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function optional(name: string): string {
  return process.env[name]?.trim() || "";
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number in env var ${name}: ${value}`);
  }
  return parsed;
}

function timeToMinutes(name: string, fallback: string): number {
  const value = (process.env[name] || fallback).trim();
  const match = value.match(/^(?:[01]?\d|2[0-3]):[0-5]\d$/);
  if (!match) {
    throw new Error(`Invalid time in env var ${name}: ${value}. Expected HH:MM`);
  }

  const [hours, minutes] = value.split(":").map(part => Number(part));
  return hours * 60 + minutes;
}

function parseWorkingDays(name: string, fallback: string): number[] {
  const value = (process.env[name] || fallback).trim();
  const parsed = value
    .split(",")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => Number(part));

  if (!parsed.length) {
    throw new Error(`Invalid working days in env var ${name}: ${value}`);
  }

  for (const day of parsed) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error(
        `Invalid day value in env var ${name}: ${day}. Use values 0..6`
      );
    }
  }

  return [...new Set(parsed)];
}

function timezoneEnv(name: string, fallback: string): string {
  const value = (process.env[name] || fallback).trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new Error(`Invalid timezone in env var ${name}: ${value}`);
  }
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  throw new Error(`Invalid boolean in env var ${name}: ${value}`);
}

function booleanEnvAuto(name: string, fallbackWhenUnset: boolean): boolean {
  if (process.env[name] === undefined) {
    return fallbackWhenUnset;
  }
  return booleanEnv(name, fallbackWhenUnset);
}

const skipSignatureVerification = booleanEnv(
  "CHATWOOT_SKIP_SIGNATURE_VERIFICATION",
  false
);

const chatwootWebhookSecret = skipSignatureVerification
  ? optional("CHATWOOT_WEBHOOK_SECRET")
  : required("CHATWOOT_WEBHOOK_SECRET");

const openrouterApiKeyOptional = optional("OPENROUTER_API_KEY");
const openrouterAvailable = Boolean(openrouterApiKeyOptional);

const agentEnabled = booleanEnvAuto("ENABLE_AGENT", openrouterAvailable);
const businessHoursEnabled = booleanEnv("BUSINESS_HOURS_ENABLED", false);

const openrouterApiKey = agentEnabled
  ? required("OPENROUTER_API_KEY")
  : openrouterApiKeyOptional;

const openrouterModel = agentEnabled
  ? required("OPENROUTER_MODEL")
  : optional("OPENROUTER_MODEL") || "openai/gpt-4o-mini";

export const config: AppConfig = {
  port: numberEnv("PORT", 4000),
  logLevel: process.env.LOG_LEVEL || "info",
  chatwootBaseUrl: required("CHATWOOT_BASE_URL").replace(/\/+$/, ""),
  chatwootAccountId: numberEnv("CHATWOOT_ACCOUNT_ID", 1),
  chatwootApiToken: required("CHATWOOT_API_TOKEN"),
  chatwootWebhookSecret,
  skipSignatureVerification,
  skillsDir: optional("SKILLS_DIR") || "./skills",
  agentEnabled,
  agentTemperature: numberEnv("AGENT_TEMPERATURE", 0.3),
  agentMaxTokens: numberEnv("AGENT_MAX_TOKENS", 320),
  agentHistoryLimit: numberEnv("AGENT_HISTORY_LIMIT", 12),
  agentMaxRetries: numberEnv("AGENT_MAX_RETRIES", 2),
  openrouterBaseUrl:
    optional("OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1",
  openrouterApiKey,
  openrouterModel,
  openrouterTimeoutMs: numberEnv("OPENROUTER_TIMEOUT_MS", 8000),
  businessHoursEnabled,
  businessTimezone: timezoneEnv(
    "BUSINESS_TIMEZONE",
    "America/Argentina/Buenos_Aires"
  ),
  businessWorkingDays: parseWorkingDays("BUSINESS_WORKING_DAYS", "1,2,3,4,5"),
  businessStartMinutes: timeToMinutes("BUSINESS_START_TIME", "09:00"),
  businessEndMinutes: timeToMinutes("BUSINESS_END_TIME", "18:00"),
  businessHoursLabel:
    optional("BUSINESS_HOURS_LABEL") || "lunes a viernes de 09:00 a 18:00"
};
