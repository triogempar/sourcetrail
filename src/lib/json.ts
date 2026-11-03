import { SchemaError } from "@/lib/errors";
import { clip } from "@/lib/text";
import type { Llm, LlmCompletion, LlmTask } from "@/lib/types";

export function asCompletion(value: string | LlmCompletion): LlmCompletion {
  return typeof value === "string" ? { content: value, finishReason: null } : value;
}

/** Close a brief that was cut off at the token limit, when the start is still valid JSON. */
export function closeTruncatedJson(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let slice = text.slice(start);
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  for (let index = 0; index < slice.length; index += 1) {
    const char = slice[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      stringStart = index;
    }
  }
  if (inString && stringStart >= 0) slice = slice.slice(0, stringStart);
  for (let pass = 0; pass < 8; pass += 1) {
    const next = slice
      .replace(/\s*:\s*$/, "")
      .replace(/,?\s*"[^"\\]*"\s*$/, "")
      .replace(/,\s*$/, "")
      .replace(/,?\s*\{\s*$/, "")
      .replace(/,?\s*\[\s*$/, "");
    if (next === slice) break;
    slice = next;
  }
  let objects = 0;
  let arrays = 0;
  inString = false;
  escaped = false;
  for (const char of slice) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") objects += 1;
    else if (char === "}") objects -= 1;
    else if (char === "[") arrays += 1;
    else if (char === "]") arrays -= 1;
  }
  if (inString || objects < 0 || arrays < 0) return null;
  slice += "]".repeat(arrays);
  slice += "}".repeat(objects);
  slice = slice.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

export function extractJson(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence?.[1] ?? trimmed).trim();
  const objectStart = body.indexOf("{");
  const arrayStart = body.indexOf("[");
  let start = -1;
  let end = -1;
  if (objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart)) {
    start = objectStart;
    end = body.lastIndexOf("}");
  } else if (arrayStart >= 0) {
    start = arrayStart;
    end = body.lastIndexOf("]");
  }
  if (start < 0 || end < start) throw new SchemaError("No JSON object found.");
  const slice = body.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    const repaired = slice.replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(repaired);
    } catch {
      throw new SchemaError("JSON could not be parsed.");
    }
  }
}

function tryValidate<T>(content: string, validate: (data: unknown) => T): { ok: true; value: T } | { ok: false; reason: string } {
  try {
    return { ok: true, value: validate(extractJson(content)) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Invalid JSON" };
  }
}

export async function completeJson<T>(options: {
  llm: Llm;
  task: LlmTask;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
  validate: (data: unknown) => T;
  recover?: (text: string) => T | null;
}): Promise<T> {
  const first = asCompletion(await options.llm.complete({
    task: options.task,
    model: options.model,
    system: options.system,
    user: options.user,
    maxTokens: options.maxTokens,
    signal: options.signal,
  }));
  const parsed = tryValidate(first.content, options.validate);
  if (parsed.ok) return parsed.value;
  const truncated = first.finishReason === "length";
  const retryTokens = truncated ? Math.min(4000, Math.max(options.maxTokens, Math.ceil(options.maxTokens * 1.5))) : options.maxTokens;
  const retryUser = truncated
    ? `${options.user}\n\nThe previous reply was cut off at the token limit. Do not continue it. Return one shorter JSON object: at most 6 sentences, each under 220 characters.`
    : `${options.user}\n\nYour previous reply was invalid (${parsed.reason}). Reply with one JSON object only. No markdown.\n\nPrevious reply:\n${clip(first.content, 1200)}`;
  const second = asCompletion(await options.llm.complete({
    task: options.task,
    model: options.model,
    system: options.system,
    user: retryUser,
    maxTokens: retryTokens,
    timeoutMs: truncated ? 22_000 : undefined,
    signal: options.signal,
  }));
  const repaired = tryValidate(second.content, options.validate);
  if (repaired.ok) return repaired.value;
  const recovered = options.recover?.(second.content) ?? options.recover?.(first.content) ?? null;
  if (recovered) return recovered;
  throw new SchemaError(`The model returned invalid JSON twice (${repaired.reason}).`);
}
