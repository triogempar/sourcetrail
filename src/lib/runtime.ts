import { getConfig, type RuntimeConfig } from "@/lib/env";
import { ConfigError } from "@/lib/errors";
import { createMockDeps } from "@/lib/mock/providers";
import { NebiusClient } from "@/lib/nebius";
import { TavilyClient } from "@/lib/tavily";
import type { AgentDeps } from "@/lib/types";

export function assertReady(config: RuntimeConfig): void {
  if (config.mock) return;
  if (!config.nebiusKey && !config.tavilyKey) {
    throw new ConfigError("NEBIUS_API_KEY and TAVILY_API_KEY are not set.");
  }
  if (!config.nebiusKey) throw new ConfigError("NEBIUS_API_KEY is not set.");
  if (!config.tavilyKey) throw new ConfigError("TAVILY_API_KEY is not set.");
}

export function createRuntime(question: string, signal?: AbortSignal, config = getConfig()): AgentDeps {
  assertReady(config);
  if (config.mock) return createMockDeps(question, config, signal);
  return {
    mode: "live",
    llm: new NebiusClient({
      apiKey: config.nebiusKey,
      baseUrl: config.nebiusBaseUrl,
      timeoutMs: config.nebiusTimeoutMs,
    }),
    search: new TavilyClient({
      apiKey: config.tavilyKey,
      searchTimeoutMs: config.tavilySearchTimeoutMs,
      extractTimeoutMs: config.tavilyExtractTimeoutMs,
    }),
    models: config.models,
    maxCredits: config.maxCredits,
    tokens: config.tokens,
    signal,
  };
}
