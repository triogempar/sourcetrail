import { describe, expect, it } from "vitest";
import { runResearch } from "@/lib/agent";
import { EXAMPLES } from "@/lib/examples";
import type { RuntimeConfig } from "@/lib/env";
import { resolveModels } from "@/lib/env";
import { ProviderError } from "@/lib/errors";
import { createMockDeps } from "@/lib/mock/providers";
import type { AgentDeps, Llm, ResearchEvent, SearchClient } from "@/lib/types";

function fixtureConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    mock: true,
    paused: false,
    configured: true,
    nebiusKey: "",
    tavilyKey: "",
    nebiusBaseUrl: "https://api.tokenfactory.nebius.com/v1",
    models: {
      primary: "deepseek-ai/DeepSeek-V4.1-Flash",
      verify: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    },
    maxCredits: 8,
    tokens: { plan: 700, rewrite: 160, write: 1600, verify: 900 },
    nebiusTimeoutMs: 25000,
    tavilySearchTimeoutMs: 14000,
    tavilyExtractTimeoutMs: 18000,
    perHour: 6,
    dailyCap: 24,
    maxQuestionLength: 500,
    mockPaceMs: 0,
    ...overrides,
  };
}

describe("mock inquiries", () => {
  it("files a sourced battery brief and strikes the unsupported cost claim", async () => {
    const question = EXAMPLES[0].question;
    const events: ResearchEvent[] = [];
    const result = await runResearch(question, createMockDeps(question, fixtureConfig()), (event) => events.push(event));
    expect(result.error).toBeNull();
    expect(result.brief?.insufficient).toBe(false);
    expect(result.brief?.lede.some((sentence) => sentence.text.includes("612 km"))).toBe(true);
    const cost = result.brief?.lede.find((sentence) => sentence.text.includes("40 percent"));
    expect(cost?.flag).toBe("partial");
    expect(result.summary?.droppedSentences.some((sentence) => sentence.text.includes("40"))).toBe(false);
    expect(result.credits).toBeLessThanOrEqual(8);
    expect(events.some((event) => event.type === "brief")).toBe(true);
    expect(result.brief?.passages.every((passage) => passage.url.startsWith("https://"))).toBe(true);
  });

  it("keeps both accounts of the grid disturbance", async () => {
    const question = EXAMPLES[1].question;
    const result = await runResearch(question, createMockDeps(question, fixtureConfig()), () => {});
    expect(result.brief?.conflicts.length).toBe(1);
    expect(result.brief?.conflicts[0]?.sides).toHaveLength(2);
    expect(result.brief?.insufficient).toBe(false);
  });

  it("says when the record is too thin, after a follow-up search", async () => {
    const question = EXAMPLES[2].question;
    const events: ResearchEvent[] = [];
    const result = await runResearch(question, createMockDeps(question, fixtureConfig()), (event) => events.push(event));
    expect(result.brief?.insufficient).toBe(true);
    expect(result.brief?.lede).toHaveLength(0);
    expect(result.brief?.gaps.join(" ")).toMatch(/no strong page/i);
    const trails = events.filter((event) => event.type === "trail");
    expect(trails.some((event) => event.type === "trail" && (event.entry.status === "retry" || event.entry.status === "empty"))).toBe(true);
  });

  it("stops in the open when search fails and files no brief", async () => {
    const question = EXAMPLES[3].question;
    const events: ResearchEvent[] = [];
    const result = await runResearch(question, createMockDeps(question, fixtureConfig()), (event) => events.push(event));
    expect(result.brief).toBeNull();
    expect(result.error).toMatch(/No brief was filed/);
    expect(events.some((event) => event.type === "brief")).toBe(false);
    expect(events.some((event) => event.type === "trail" && event.entry.status === "error")).toBe(true);
  });
});

describe("credit cap", () => {
  it("stops searching once the reserved budget is spent", async () => {
    let searches = 0;
    const llm: Llm = {
      async complete(input) {
        if (input.task === "plan") {
          return JSON.stringify({
            language: "en",
            recency: false,
            topic: "general",
            subquestions: [
              { id: "sq1", question: "What did the first source report?", query: "first source report" },
              { id: "sq2", question: "What did the second source report?", query: "second source report" },
              { id: "sq3", question: "What did the third source report?", query: "third source report" },
            ],
          });
        }
        if (input.task === "rewrite") return JSON.stringify({ query: "another query entirely" });
        if (input.task === "write") {
          return JSON.stringify({
            headline: "A sourced headline from the only page",
            insufficient: false,
            lede: [{
              text: "The only kept page says a measured highway range was recorded in Hamburg.",
              kind: "fact",
              citations: ["p1"],
            }],
            sections: [],
            conflicts: [],
            gaps: [],
          });
        }
        return JSON.stringify({ sentences: [{ id: "s1", verdict: "supported", reason: "ok" }] });
      },
    };
    const search: SearchClient = {
      async search() {
        searches += 1;
        return [{
          title: "Hamburg note",
          url: "https://example.com/only",
          content: "The only kept page says a measured highway range was recorded in Hamburg by the city university.",
          score: 0.9,
          publishedDate: "2026-10-01",
          publisher: "Example",
        }];
      },
      async extract(input) {
        return {
          documents: input.urls.map((url) => ({
            url,
            rawContent: "The only kept page says a measured highway range was recorded in Hamburg by the city university.",
          })),
          failed: [],
        };
      },
    };
    const deps: AgentDeps = {
      mode: "live",
      llm,
      search,
      models: fixtureConfig().models,
      maxCredits: 2,
      tokens: fixtureConfig().tokens,
    };
    const events: ResearchEvent[] = [];
    const result = await runResearch("What did the sources report about the range?", deps, (event) => events.push(event));
    expect(searches).toBe(1);
    expect(result.credits).toBeLessThanOrEqual(2);
    expect(events.some((event) => event.type === "trail" && /credit cap/i.test(event.entry.detail ?? ""))).toBe(true);
  });
});

describe("terminal search errors", () => {
  it("does not buy a follow-up search after Tavily rejects the key", async () => {
    let searches = 0;
    const llm: Llm = {
      async complete(input) {
        if (input.task === "plan") {
          return JSON.stringify({
            language: "en",
            recency: false,
            topic: "general",
            subquestions: [
              { id: "sq1", question: "What did the first source report?", query: "first source report" },
              { id: "sq2", question: "What did the second source report?", query: "second source report" },
              { id: "sq3", question: "What did the third source report?", query: "third source report" },
            ],
          });
        }
        return "{\"query\":\"unused rewrite\"}";
      },
    };
    const search: SearchClient = {
      async search() {
        searches += 1;
        throw new ProviderError("tavily", 401, "Tavily rejected the API key.");
      },
      async extract() {
        return { documents: [], failed: [] };
      },
    };
    const deps: AgentDeps = {
      mode: "live",
      llm,
      search,
      models: fixtureConfig().models,
      maxCredits: 8,
      tokens: fixtureConfig().tokens,
    };
    const result = await runResearch("What did the sources report about the range?", deps, () => {});
    expect(searches).toBe(3);
    expect(result.brief).toBeNull();
    expect(result.credits).toBe(3);
  });
});

describe("resolveModels", () => {
  it("refuses to verify with the same model that drafted", () => {
    const previousModel = process.env.NEBIUS_MODEL;
    const previousVerify = process.env.NEBIUS_VERIFY_MODEL;
    process.env.NEBIUS_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";
    process.env.NEBIUS_VERIFY_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";
    try {
      const models = resolveModels();
      expect(models.verify).not.toBe(models.primary);
    } finally {
      if (previousModel === undefined) delete process.env.NEBIUS_MODEL;
      else process.env.NEBIUS_MODEL = previousModel;
      if (previousVerify === undefined) delete process.env.NEBIUS_VERIFY_MODEL;
      else process.env.NEBIUS_VERIFY_MODEL = previousVerify;
    }
  });
});
