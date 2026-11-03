export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

export class ProviderError extends Error {
  readonly provider: "nebius" | "tavily";
  readonly status: number | "timeout";

  constructor(provider: "nebius" | "tavily", status: number | "timeout", message: string) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError" && !/timeout/i.test(error.message);
}

export function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || (error.name === "AbortError" && /timeout/i.test(error.message)));
}

export function isTerminalProviderError(error: unknown): boolean {
  return error instanceof ProviderError && (error.status === 401 || error.status === 402 || error.status === 403 || error.status === 429);
}

export function providerMessage(error: unknown): string {
  if (error instanceof ProviderError || error instanceof SchemaError || error instanceof ConfigError) {
    return error.message;
  }
  if (isAbort(error)) return "The request was cancelled.";
  if (error instanceof Error && error.message.trim()) return clipMessage(error.message);
  return "Unexpected failure.";
}

function clipMessage(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 180) return trimmed;
  return `${trimmed.slice(0, 177)}...`;
}
