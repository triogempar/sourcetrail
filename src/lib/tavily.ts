import { isAbort, isTimeout, ProviderError } from "@/lib/errors";
import { clip, withTimeout } from "@/lib/text";
import type { ExtractRequest, ExtractResult, SearchClient, SearchHit, SearchRequest } from "@/lib/types";

export function parseSearchHits(data: unknown): SearchHit[] {
  if (!data || typeof data !== "object") return [];
  const results = (data as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const hits: SearchHit[] = [];
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (!url || !content) continue;
    const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : url;
    const score = typeof record.score === "number" && Number.isFinite(record.score) ? record.score : 0.5;
    const published = record.published_date ?? record.publishedDate;
    hits.push({
      title,
      url,
      content,
      score,
      publishedDate: typeof published === "string" && published.trim() ? published.trim() : null,
    });
  }
  return hits;
}

export function parseExtract(data: unknown): ExtractResult {
  const documents: ExtractResult["documents"] = [];
  const failed: ExtractResult["failed"] = [];
  if (!data || typeof data !== "object") return { documents, failed };
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.results)) {
    for (const row of record.results) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const url = typeof item.url === "string" ? item.url.trim() : "";
      const raw = item.raw_content ?? item.rawContent;
      if (!url || typeof raw !== "string" || !raw.trim()) continue;
      documents.push({ url, rawContent: raw });
    }
  }
  const failures = record.failed_results ?? record.failedResults;
  if (Array.isArray(failures)) {
    for (const row of failures) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const url = typeof item.url === "string" ? item.url.trim() : "";
      if (!url) continue;
      const error = typeof item.error === "string" ? item.error : "Extract failed";
      failed.push({ url, error: clip(error, 160) });
    }
  }
  return { documents, failed };
}

async function safeBody(response: Response): Promise<string> {
  try {
    return clip(await response.text(), 240);
  } catch {
    return "";
  }
}

function tavilyErrorMessage(status: number): string {
  if (status === 401 || status === 403) return "Tavily rejected the API key.";
  if (status === 429) return "Tavily rate limit or credit limit reached.";
  if (status === 432 || status === 433) return "Tavily refused the request. Check the plan credits before retrying.";
  return "Tavily returned an error.";
}

export class TavilyClient implements SearchClient {
  constructor(private readonly options: { apiKey: string; searchTimeoutMs: number; extractTimeoutMs: number }) {}

  async search(input: SearchRequest): Promise<SearchHit[]> {
    const body: Record<string, unknown> = {
      query: input.query,
      search_depth: "basic",
      topic: input.topic,
      max_results: input.maxResults,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      chunks_per_source: 2,
    };
    if (input.timeRange) body.time_range = input.timeRange;
    const data = await this.post("https://api.tavily.com/search", body, input.signal, this.options.searchTimeoutMs);
    return parseSearchHits(data);
  }

  async extract(input: ExtractRequest): Promise<ExtractResult> {
    const data = await this.post(
      "https://api.tavily.com/extract",
      {
        urls: input.urls,
        extract_depth: "basic",
        format: "text",
        query: input.query,
        chunks_per_source: 3,
        include_images: false,
      },
      input.signal,
      this.options.extractTimeoutMs,
    );
    return parseExtract(data);
  }

  private async post(url: string, body: unknown, parent: AbortSignal | undefined, timeoutMs: number): Promise<unknown> {
    const signal = withTimeout(parent, timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
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
      if (isTimeout(error)) throw new ProviderError("tavily", "timeout", "Tavily timed out before returning results.");
      throw new ProviderError("tavily", 0, "Tavily could not be reached.");
    }
    if (!response.ok) {
      const detail = await safeBody(response);
      console.error(`tavily ${response.status} ${detail}`);
      throw new ProviderError("tavily", response.status, tavilyErrorMessage(response.status));
    }
    try {
      return await response.json();
    } catch {
      throw new ProviderError("tavily", response.status, "Tavily returned a response that was not JSON.");
    }
  }
}
