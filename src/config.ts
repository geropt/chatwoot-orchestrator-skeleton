import "dotenv/config";

export type Config = {
  port: number;
  logLevel: string;
  chatwoot: {
    baseUrl: string;
    accountId: number;
    apiToken: string;
    webhookSecret: string;
    skipSignatureVerification: boolean;
  };
  skillsDir: string;
  anthropic: {
    apiKey: string;
    model: string;
  };
  agent: {
    maxTurns: number;
    maxRetries: number;
    maxToolIterations: number;
    temperature: number;
    maxTokens: number;
  };
  support: {
    timezone: string;
    businessHours: BusinessHoursConfig;
    holidays: string[];
    emergencyPhone: string;
  };
};

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type BusinessHoursPeriod = {
  start: string;
  end: string;
};

export type BusinessHoursConfig = Partial<Record<Weekday, BusinessHoursPeriod[]>>;

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function asBoolean(value: string, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return fallback;
}

function asNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Env var ${name} must be a number, got: ${raw}`);
  }
  return parsed;
}

const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  monday: [{ start: "08:30", end: "17:00" }],
  tuesday: [{ start: "08:30", end: "17:00" }],
  wednesday: [{ start: "08:30", end: "17:00" }],
  thursday: [{ start: "08:30", end: "17:00" }],
  friday: [{ start: "08:30", end: "17:00" }]
};

function asBusinessHours(name: string): BusinessHoursConfig {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return DEFAULT_BUSINESS_HOURS;
  try {
    return JSON.parse(raw) as BusinessHoursConfig;
  } catch (err) {
    throw new Error(
      `Env var ${name} must be valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

function asCsv(name: string): string[] {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function loadConfig(): Config {
  const skipSignatureVerification = asBoolean(
    process.env.CHATWOOT_SKIP_SIGNATURE_VERIFICATION ?? "",
    false
  );

  const baseUrl = required("CHATWOOT_BASE_URL").replace(/\/$/, "");
  const accountId = asNumber("CHATWOOT_ACCOUNT_ID", 1);
  const apiToken = required("CHATWOOT_API_TOKEN");
  const webhookSecret = skipSignatureVerification
    ? optional("CHATWOOT_WEBHOOK_SECRET", "")
    : required("CHATWOOT_WEBHOOK_SECRET");

  return {
    port: asNumber("PORT", 4000),
    logLevel: optional("LOG_LEVEL", "info"),
    chatwoot: {
      baseUrl,
      accountId,
      apiToken,
      webhookSecret,
      skipSignatureVerification
    },
    skillsDir: optional("SKILLS_DIR", "./skills"),
    anthropic: {
      apiKey: required("ANTHROPIC_API_KEY"),
      model: optional("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    },
    agent: {
      maxTurns: asNumber("AGENT_MAX_TURNS", 8),
      maxRetries: asNumber("AGENT_MAX_RETRIES", 2),
      maxToolIterations: asNumber("AGENT_MAX_TOOL_ITERATIONS", 3),
      temperature: asNumber("AGENT_TEMPERATURE", 0.3),
      maxTokens: asNumber("AGENT_MAX_TOKENS", 1024)
    },
    support: {
      timezone: optional("SUPPORT_TIMEZONE", "America/Argentina/Buenos_Aires"),
      businessHours: asBusinessHours("SUPPORT_BUSINESS_HOURS_JSON"),
      holidays: asCsv("SUPPORT_HOLIDAYS"),
      emergencyPhone: optional("SUPPORT_EMERGENCY_PHONE", "")
    }
  };
}
