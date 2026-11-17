import { describe, expect, it } from "vitest";
import {
  briefLabels,
  planFrameDetail,
  searchesUsedLabel,
  trailDecisionLabel,
  trailPhaseLabel,
  trimExcerptJunk,
} from "@/lib/text";

describe("plain-language labels", () => {
  it("names the brief and the trail in everyday English", () => {
    const labels = briefLabels("en");
    expect(labels.brief).toBe("Your brief");
    expect(labels.insufficient).toBe("We couldn't find enough evidence");
    expect(labels.contested).toBe("Sources don't agree");
    expect(labels.kept).toBe("Sources we used");
    expect(labels.unread).toBe("Pages we opened but didn't quote");
    expect(labels.verification).toBe("How we checked this");
    expect(labels.inference).toBe("Interpretation");
    expect(labels.check).toBe("Only partly supported");
    expect(labels.struck).toBe("Removed sentences");
    expect(labels.copy).toBe("Copy as text");
    expect(labels.fixture).toBe("Demo mode");
    expect(labels.noAnswer).toBe("We couldn't find an answer.");
    expect(labels.removed(2)).toBe("We removed 2 sentences because the sources didn't support them.");
    expect(labels.openOriginal).toBe("Open the original page");
    expect(labels.searchPreview).toBe("From the search preview (we couldn't open the full page)");
    expect(trailPhaseLabel("en", "plan")).toBe("Breaking down the question");
    expect(trailPhaseLabel("en", "verify")).toBe("Checking the answer");
    expect(trailDecisionLabel("en", "kept")).toBe("Used");
    expect(trailDecisionLabel("en", "discarded")).toBe("Skipped");
    expect(trailDecisionLabel("en", "failed")).toBe("Couldn't open");
    expect(trailDecisionLabel("en", "candidate")).toBe("Possible source");
    expect(searchesUsedLabel("en", 2, 8)).toBe("Searches used: 2 of 8");
    expect(planFrameDetail("en", 3)).toBe("3 smaller questions.");
  });

  it("uses plain Indonesian for the same labels", () => {
    const labels = briefLabels("id");
    expect(labels.inference).toBe("Tafsiran");
    expect(labels.struck).toBe("Kalimat yang kami hapus");
    expect(labels.fixture).toBe("Mode demo");
    expect(labels.copy).toBe("Salin sebagai teks");
    expect(labels.verification).toBe("Cara kami memeriksa ini");
    expect(trailPhaseLabel("id", "search")).toBe("Mencari");
    expect(trailDecisionLabel("id", "discarded")).toBe("Dilewati");
    expect(planFrameDetail("id", 4)).toBe("4 jalur pertanyaan. Bahasa: id.");
  });
});

describe("excerpt captions", () => {
  it("drops a leading caption line and keeps the quote", () => {
    const quote = "A Hamburg pilot reported a 612 km highway range at a constant 90 km/h.";
    expect(trimExcerptJunk(`Photo: A test car on the autobahn.\n${quote}`)).toBe(quote);
    expect(trimExcerptJunk(`![battery](https://example.com/a.jpg)\n${quote}`)).toBe(quote);
  });

  it("leaves a real sentence that merely starts with a similar word", () => {
    const sentence = "Credit Suisse reported earnings of 12 billion in the latest quarter.";
    expect(trimExcerptJunk(sentence)).toBe(sentence);
    expect(trimExcerptJunk(`Photo of the range was 612 km on the highway yesterday.`)).toBe(
      "Photo of the range was 612 km on the highway yesterday.",
    );
  });
});
