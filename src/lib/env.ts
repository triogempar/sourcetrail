export type RuntimeConfig = {
  mock: boolean;
  paused: boolean;
  configured: boolean;
  nebiusKey: string;
  tavilyKey: string;
  nebiusBaseUrl: string;
  models: { primary: string; verify: string };
  maxCredits: number;
  tokens: { plan: number; rewrite: number; write: number; verify: number };
  nebiusTimeoutMs: number;
  tavilySearchTimeoutMs: number;
  tavilyExtractTimeoutMs: number;
  perHour: number;
  dailyCap: number;
  maxQuestionLength: number;
  mockPaceMs: number;
};

export type PublicConfig = {
  paused: boolean;
  mock: boolean;
  configured: boolean;
  models: { primary: string; verify: string };
  perHour: number;
  dailyCap: number;
  maxCredits: number;
  maxQuestionLength: number;
};

const VERIFY_FALLBACKS = [
  "Qwen/Qwen3-235B-A22B-Instruct-2507",
  "openai/gpt-oss-120b",
  "zai-org/GLM-5.3",
];

function read(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function intInRange(name: string, fallback: number, min: number, max: number): number {
  const raw = read(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export const DEFAULT_NEBIUS_TIMEOUT_MS = 40_000;
export const DEFAULT_VERIFY_TOKENS = 1_600;
export const DEFAULT_WRITE_TOKENS = 3_200;

export function resolveModels(): { primary: string; verify: string } {
  const primary = read("NEBIUS_MODEL") || "deepseek-ai/DeepSeek-V4.1-Flash";
  const requested = read("NEBIUS_VERIFY_MODEL") || "Qwen/Qwen3-235B-A22B-Instruct-2507";
  const verify = requested !== primary ? requested : VERIFY_FALLBACKS.find((id) => id !== primary) ?? requested;
  return { primary, verify };
}

export function getConfig(): RuntimeConfig {
  const nebiusKey = read("NEBIUS_API_KEY") ?? "";
  const tavilyKey = read("TAVILY_API_KEY") ?? "";
  const mock = read("SOURCETRAIL_MOCK") === "1";
  const models = resolveModels();
  return {
    mock,
    paused: read("SOURCETRAIL_DISABLED") === "1",
    configured: mock || (Boolean(nebiusKey) && Boolean(tavilyKey)),
    nebiusKey,
    tavilyKey,
    nebiusBaseUrl: (read("NEBIUS_BASE_URL") || "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, ""),
    models,
    maxCredits: intInRange("SOURCETRAIL_MAX_TAVILY_CREDITS", 8, 1, 10),
    tokens: {
      plan: intInRange("SOURCETRAIL_MAX_TOKENS_PLAN", 700, 200, 1200),
      rewrite: intInRange("SOURCETRAIL_MAX_TOKENS_REWRITE", 160, 60, 300),
      write: intInRange("SOURCETRAIL_MAX_TOKENS_WRITE", DEFAULT_WRITE_TOKENS, 800, 4000),
      verify: intInRange("SOURCETRAIL_MAX_TOKENS_VERIFY", DEFAULT_VERIFY_TOKENS, 400, 2400),
    },
    nebiusTimeoutMs: intInRange("NEBIUS_TIMEOUT_MS", DEFAULT_NEBIUS_TIMEOUT_MS, 5000, 55_000),
    tavilySearchTimeoutMs: intInRange("TAVILY_SEARCH_TIMEOUT_MS", 14000, 4000, 30000),
    tavilyExtractTimeoutMs: intInRange("TAVILY_EXTRACT_TIMEOUT_MS", 18000, 4000, 30000),
    perHour: intInRange("SOURCETRAIL_RATE_LIMIT_PER_HOUR", 6, 1, 24),
    dailyCap: intInRange("SOURCETRAIL_DAILY_CAP", 24, 1, 48),
    maxQuestionLength: intInRange("SOURCETRAIL_MAX_QUESTION_LENGTH", 500, 80, 2000),
    mockPaceMs: mock ? intInRange("SOURCETRAIL_MOCK_PACE_MS", 180, 0, 2000) : 0,
  };
}

export function getPublicConfig(): PublicConfig {
  const config = getConfig();
  return {
    paused: config.paused,
    mock: config.mock,
    configured: config.configured,
    models: config.models,
    perHour: config.perHour,
    dailyCap: config.dailyCap,
    maxCredits: config.maxCredits,
    maxQuestionLength: config.maxQuestionLength,
  };
}
