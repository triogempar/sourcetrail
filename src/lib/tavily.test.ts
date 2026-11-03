import { describe, expect, it } from "vitest";
import { readChatContent } from "@/lib/nebius";
import { flattenMarkdownTables, passagesFromDocument } from "@/lib/passages";
import { parseExtract, parseSearchHits } from "@/lib/tavily";

describe("Tavily parsers", () => {
  it("keeps scored search hits and ignores empty rows", () => {
    const hits = parseSearchHits({
      results: [
        {
          title: "Harbor Desk",
          url: "https://example.com/a",
          content: "A measured highway range from a single instrumented car.",
          score: 0.8,
          published_date: "2026-10-28",
        },
        { title: "Blank", url: "https://example.com/b", content: "  " },
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.publishedDate).toBe("2026-10-28");
    expect(hits[0]?.score).toBe(0.8);
  });

  it("splits extract successes from failed urls", () => {
    const parsed = parseExtract({
      results: [{ url: "https://example.com/a", raw_content: "Paragraph one is long enough to keep.\n\nParagraph two is also long enough to keep as a separate passage for the brief." }],
      failed_results: [{ url: "https://example.com/b", error: "timeout" }],
    });
    expect(parsed.documents).toHaveLength(1);
    expect(parsed.failed[0]?.error).toBe("timeout");
    const chunks = passagesFromDocument(parsed.documents[0]!.rawContent, "paragraph passage");
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("turns a markdown table into label lines", () => {
    const flat = flattenMarkdownTables("| Issue | Share |\n| --- | --- |\n| The economy | 84 |\n| Immigration | 61 |");
    expect(flat).toContain("The economy: 84");
    expect(flat).toContain("Immigration: 61");
    expect(flat).not.toContain("---");
  });
});

describe("readChatContent", () => {
  it("reads string and array message content", () => {
    expect(readChatContent({ choices: [{ message: { content: "{\"ok\":true}" } }] })).toBe("{\"ok\":true}");
    expect(readChatContent({
      choices: [{ message: { content: [{ type: "text", text: "Hello" }, { type: "text", text: " there" }] } }],
    })).toBe("Hello there");
  });
});
