import { isAbort, isTimeout, ProviderError } from "@/lib/errors";
import { clip, withTimeout } from "@/lib/text";
import type { Llm, LlmCompletion, LlmRequest, LlmTask } from "@/lib/types";

export function modelThinksByDefault(model: string): boolean {
  const id = model.toLowerCase();
  return id.includes("deepseek") || id.includes("qwen3") || id.includes("qwq") || id.includes("thinking");
}

export function timeoutForTask(task: LlmTask, budgetMs: number): number {
  if (task === "rewrite") return Math.min(budgetMs, 20_000);
  if (task === "plan") return Math.min(budgetMs, 30_000);
  return Math.min(budgetMs, 45_000);
}

export function buildChatCompletionBody(input: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    stream: false,
  };
  if (modelThinksByDefault(input.model)) {
    body.chat_template_kwargs = { thinking: false };
  }
  return body;
}

export function readReasoningTokens(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const usage = (data as { usage?: unknown }).usage;
  if (usage && typeof usage === "object") {
    const details = (usage as { completion_tokens_details?: unknown }).completion_tokens_details;
    if (details && typeof details === "object") {
      const reasoning = (details as { reasoning_tokens?: unknown }).reasoning_tokens;
      if (typeof reasoning === "number" && reasoning > 0) return reasoning;
    }
  }
  const choices = (data as { choices?: unknown }).choices;
  const message = Array.isArray(choices) && choices[0] && typeof choices[0] === "object"
    ? (choices[0] as { message?: unknown }).message
    : undefined;
  if (message && typeof message === "object") {
    const reasoning = (message as { reasoning_content?: unknown }).reasoning_content;
    if (typeof reasoning === "string" && reasoning.trim()) return reasoning.trim().length;
  }
  return 0;
}

export function readFinishReason(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
  return typeof reason === "string" ? reason : null;
}

export function readChatContent(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
      return (part as { text: string }).text;
    }
    return "";
  }).join("");
}

function nebiusErrorMessage(status: number): string {
  if (status === 401 || status === 403) return "Nebius rejected the API key.";
  if (status === 402) return "Nebius refused the request. Check the Token Factory balance before retrying.";
  if (status === 429) return "Nebius rate limit reached. Wait a moment and try again.";
  if (status === 400) return "Nebius rejected the completion request.";
  return "Nebius returned an error.";
}

async function safeBody(response: Response): Promise<string> {
  try {
    return clip(await response.text(), 240);
  } catch {
    return "";
  }
}

export class NebiusClient implements Llm {
  constructor(private readonly options: { apiKey: string; baseUrl: string; timeoutMs: number }) {}

  async complete(input: LlmRequest): Promise<LlmCompletion> {
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const budget = input.timeoutMs ?? this.options.timeoutMs;
    const signal = withTimeout(input.signal, timeoutForTask(input.task, budget));
    const body = buildChatCompletionBody({
      model: input.model,
      system: input.system,
      user: input.user,
      maxTokens: input.maxTokens,
      temperature: input.task === "write" ? 0.2 : 0.1,
    });
    let response = await this.post(url, body, signal);
    if (!response.ok && response.status === 400 && "chat_template_kwargs" in body) {
      const detail = await safeBody(response);
      if (/chat_template|thinking|extra/i.test(detail)) {
        delete body.chat_template_kwargs;
        response = await this.post(url, body, signal);
      } else {
        console.error(`nebius ${response.status} ${detail}`);
        throw new ProviderError("nebius", response.status, nebiusErrorMessage(response.status));
      }
    }
    if (!response.ok) {
      const detail = await safeBody(response);
      console.error(`nebius ${response.status} ${detail}`);
      throw new ProviderError("nebius", response.status, nebiusErrorMessage(response.status));
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ProviderError("nebius", response.status, "Nebius returned a response that was not JSON.");
    }
    const text = readChatContent(data);
    if (!text.trim()) {
      const reasoning = readReasoningTokens(data);
      const message = reasoning > 0
        ? "The model spent its token budget on reasoning and returned no answer."
        : "Nebius returned an empty completion.";
      throw new ProviderError("nebius", response.status, message);
    }
    return { content: text, finishReason: readFinishReason(data) };
  }

  private async post(url: string, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      if (isTimeout(error)) throw new ProviderError("nebius", "timeout", "Nebius timed out before answering.");
      throw new ProviderError("nebius", 0, "Nebius could not be reached.");
    }
  }
}
