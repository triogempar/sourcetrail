import { SchemaError } from "@/lib/errors";
import { clip } from "@/lib/text";
import type { Llm, LlmTask } from "@/lib/types";

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

export async function completeJson<T>(options: {
  llm: Llm;
  task: LlmTask;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
  validate: (data: unknown) => T;
}): Promise<T> {
  const first = await options.llm.complete({
    task: options.task,
    model: options.model,
    system: options.system,
    user: options.user,
    maxTokens: options.maxTokens,
    signal: options.signal,
  });
  try {
    return options.validate(extractJson(first));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid JSON";
    const second = await options.llm.complete({
      task: options.task,
      model: options.model,
      system: options.system,
      user: `${options.user}\n\nYour previous reply was invalid (${reason}). Reply with one JSON object only. No markdown.\n\nPrevious reply:\n${clip(first, 1800)}`,
      maxTokens: options.maxTokens,
      signal: options.signal,
    });
    try {
      return options.validate(extractJson(second));
    } catch (secondError) {
      const secondReason = secondError instanceof Error ? secondError.message : "Invalid JSON";
      throw new SchemaError(`The model returned invalid JSON twice (${secondReason}).`);
    }
  }
}
