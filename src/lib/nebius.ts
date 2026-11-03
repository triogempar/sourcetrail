import { isAbort, isTimeout, ProviderError } from "@/lib/errors";
import { clip, withTimeout } from "@/lib/text";
import type { Llm, LlmRequest } from "@/lib/types";

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

  async complete(input: LlmRequest): Promise<string> {
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const signal = withTimeout(input.signal, this.options.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          temperature: input.task === "write" ? 0.2 : 0.1,
          max_tokens: input.maxTokens,
          stream: false,
        }),
        signal,
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      if (isTimeout(error)) throw new ProviderError("nebius", "timeout", "Nebius timed out before answering.");
      throw new ProviderError("nebius", 0, "Nebius could not be reached.");
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
    if (!text.trim()) throw new ProviderError("nebius", response.status, "Nebius returned an empty completion.");
    return text;
  }
}
