import { ProviderError } from "@/lib/errors";

export const DEFAULT_PRIMARY_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
export const DEFAULT_VERIFY_MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507";

/** MiniMax-M3 is 428B at $0.30/$1.20. GLM-5.3-Flash is 320B at $0.15/$0.50. */
export const DEFAULT_FALLBACK_MODELS = [
  "MiniMaxAI/MiniMax-M3",
  "zai-org/GLM-5.3-Flash",
] as const;

export const DEFAULT_VERIFY_FALLBACK_MODELS = [
  "zai-org/GLM-5.3-Flash",
  "MiniMaxAI/MiniMax-M3",
] as const;

export function parseModelList(value: string | undefined, fallback: readonly string[]): string[] {
  if (!value) return [...fallback];
  const parsed = value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : [...fallback];
}

/** Auth and billing failures stay on the model that returned them. Availability failures move on. */
export function shouldRetryWithNextModel(status: number | "timeout", detail: string): boolean {
  if (status === 401 || status === 402 || status === 403) return false;
  if (status === "timeout" || status === 404 || status === 429) return true;
  if (typeof status === "number" && status >= 500 && status <= 599) return true;
  return /model_not_found/i.test(detail);
}

export class ModelUnavailableError extends ProviderError {
  constructor(status: number | "timeout", message: string) {
    super("nebius", status, message);
    this.name = "ModelUnavailableError";
  }
}

/** Requested model first, then spares, skipping ids that already failed in this request. */
export function modelChain(requested: string, fallbacks: readonly string[], failed: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const id of [requested, ...fallbacks]) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed) || failed.has(trimmed)) continue;
    seen.add(trimmed);
    chain.push(trimmed);
  }
  return chain;
}
