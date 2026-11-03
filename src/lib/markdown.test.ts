import { describe, expect, it } from "vitest";
import { briefToMarkdown, citationOrder } from "@/lib/markdown";
import { takeNdjson } from "@/lib/ndjson";
import { emptyStream, reduceStream } from "@/lib/stream-state";
import type { Brief, TrailEntry } from "@/lib/types";

const brief: Brief = {
  question: "What range was reported?",
  headline: "One Hamburg car posted a 612 km highway range",
  language: "en",
  insufficient: false,
  lede: [
    { id: "s1", text: "A Hamburg pilot reported a 612 km highway range.", kind: "fact", citations: ["p1"] },
    { id: "s2", text: "One car is a thin basis for a fleet claim.", kind: "inference", citations: ["p1"] },
  ],
  sections: [],
  conflicts: [],
  gaps: ["No price is reported."],
  searched: [{ subquestion: "What range was reported?", queries: ["hamburg range"] }],
  passages: [{
    id: "p1",
    url: "https://example.com/sourcetrail/harbor-desk/hamburg-range",
    title: "Range",
    publisher: "Harbor Desk",
    publishedDate: "2026-10-28",
    text: "A Hamburg pilot reported a 612 km highway range.",
    origin: "extract",
  }],
  models: { primary: "deepseek-ai/DeepSeek-V4.1-Flash", verify: "Qwen/Qwen3-235B-A22B-Instruct-2507", mode: "mock" },
};

describe("markdown export", () => {
  it("numbers footnotes in first-citation order", () => {
    expect(citationOrder(brief)).toEqual(["p1"]);
    const markdown = briefToMarkdown(brief, {
      checked: 2,
      supported: 1,
      flagged: 0,
      dropped: 0,
      inferences: 1,
      droppedSentences: [],
      verifier: "local",
      note: "Checked locally.",
    });
    expect(markdown).toContain("[^1]");
    expect(markdown).toContain("Harbor Desk");
    expect(markdown).toContain("*(inference)*");
    expect(markdown).toContain("Not yet answered");
    expect(markdown).toContain("Fixture desk");
  });
});

describe("ndjson and stream state", () => {
  it("keeps a partial line for the next chunk", () => {
    const first = takeNdjson('{"type":"meta"}\n{"type":"tra');
    expect(first.events).toHaveLength(1);
    const second = takeNdjson(`${first.rest}il"}\n`);
    expect(second.events).toEqual([{ type: "trail" }]);
  });

  it("replaces a trail entry with the same id", () => {
    const entry: TrailEntry = { id: "search-sq1-r1", phase: "search", status: "active", title: "Range", query: "hamburg" };
    const started = reduceStream(emptyStream(), {
      type: "meta",
      mock: true,
      models: { primary: "a", verify: "b" },
      maxCredits: 8,
      question: "What range?",
    });
    const active = reduceStream(started, { type: "trail", entry });
    const done = reduceStream(active, { type: "trail", entry: { ...entry, status: "ok", detail: "3 results" } });
    expect(done.trail).toHaveLength(1);
    expect(done.trail[0]?.status).toBe("ok");
  });
});
