import { describe, expect, it } from "vitest";
import { isWeak, selectSources } from "@/lib/sources";
import type { SearchHit } from "@/lib/types";

function hit(url: string, score: number, content = "A long enough snippet of text for the selector to treat as a real page result."): SearchHit {
  return { title: url, url, content, score, publishedDate: null };
}

describe("selectSources", () => {
  it("drops weak matches, duplicates, and pages over the extract budget", () => {
    const { kept, discarded } = selectSources([
      {
        subquestionId: "sq1",
        hits: [
          hit("https://example.com/a", 0.9),
          hit("https://example.com/a?dup=1", 0.2),
          hit("https://example.com/weak", 0.1, "short"),
        ],
      },
      {
        subquestionId: "sq2",
        hits: [hit("https://example.com/b", 0.8), hit("https://example.com/c", 0.7)],
      },
      {
        subquestionId: "sq3",
        hits: [hit("https://example.com/d", 0.6)],
      },
    ], 2);
    expect(kept.map((item) => item.url).sort()).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(discarded.some((item) => item.reason === "Weak match")).toBe(true);
    expect(discarded.some((item) => item.reason === "Held back to stay inside the extract budget")).toBe(true);
  });

  it("treats an empty result set as weak", () => {
    expect(isWeak([])).toBe(true);
    expect(isWeak([hit("https://example.com/a", 0.9)])).toBe(false);
  });
});
