import { describe, expect, it } from "vitest";
import type { Passage } from "@/lib/types";
import { adjudicate, tagDraft } from "@/lib/verify";

const passages: Passage[] = [
  {
    id: "p1",
    url: "https://example.com/sourcetrail/harbor-desk/hamburg-range",
    title: "Range",
    publisher: "Harbor Desk",
    publishedDate: "2026-10-28",
    origin: "extract",
    text: "A Hamburg pilot of solid-state cells in a midsize passenger car reported a 612 km highway range at a constant 90 km/h, measured by the city's technical university on 28 October 2026.",
  },
  {
    id: "p2",
    url: "https://example.com/sourcetrail/peninsula-power/alentejo-memo",
    title: "Memo",
    publisher: "Peninsula Power Review",
    publishedDate: "2026-09-18",
    origin: "extract",
    text: "A separate engineering memo argued the disturbance began with a frequency trip in a cluster of solar inverters in Alentejo.",
  },
];

describe("adjudicate", () => {
  it("strikes an unsupported fact even when a model marks it supported", () => {
    const draft = tagDraft({
      headline: "One Hamburg car posted a 612 km highway range",
      insufficient: false,
      lede: [
        {
          text: "A Hamburg pilot of solid-state cells in a midsize passenger car reported a 612 km highway range at a constant 90 km/h.",
          kind: "fact",
          citations: ["p1"],
        },
        {
          text: "The pilots have already cut pack cost by 40 percent.",
          kind: "fact",
          citations: ["p1"],
        },
        {
          text: "One instrumented car is a thin basis for a fleet claim.",
          kind: "inference",
          citations: ["p1"],
        },
      ],
      sections: [],
      conflicts: [],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages,
      modelVerdicts: [
        { id: "s1", verdict: "supported", reason: "ok" },
        { id: "s2", verdict: "supported", reason: "rubber stamp" },
        { id: "s3", verdict: "supported", reason: "ok" },
      ],
      mode: "mock",
      modelError: null,
    });
    expect(result.lede.map((sentence) => sentence.text).join(" ")).not.toMatch(/40/);
    expect(result.summary.droppedSentences.some((sentence) => sentence.reason.includes("40%"))).toBe(true);
    expect(result.summary.note).toMatch(/overrode/);
    expect(result.lede.some((sentence) => sentence.kind === "inference")).toBe(true);
  });

  it("drops an inference that invents a figure", () => {
    const draft = tagDraft({
      headline: "Range notes from the Hamburg pilot",
      insufficient: false,
      lede: [
        {
          text: "The Hamburg result implies a 40 percent cost cut.",
          kind: "inference",
          citations: ["p1"],
        },
      ],
      sections: [],
      conflicts: [],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages,
      modelVerdicts: null,
      mode: "live",
      modelError: null,
    });
    expect(result.lede).toHaveLength(0);
    expect(result.insufficient).toBe(true);
  });

  it("does not present a one-sided conflict as a dispute", () => {
    const draft = tagDraft({
      headline: "Reports do not agree on the Iberian grid trigger",
      insufficient: false,
      lede: [],
      sections: [],
      conflicts: [
        {
          topic: "Trigger",
          sides: [
            {
              label: "Inverters",
              sentences: [{
                text: "A separate engineering memo argued the disturbance began with a frequency trip in a cluster of solar inverters in Alentejo.",
                kind: "fact",
                citations: ["p2"],
              }],
            },
            {
              label: "Invented",
              sentences: [{
                text: "A Madrid studio attributed the disturbance to a meteor strike.",
                kind: "fact",
                citations: ["p2"],
              }],
            },
          ],
        },
      ],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages,
      modelVerdicts: null,
      mode: "live",
      modelError: "Nebius timed out before answering.",
    });
    expect(result.conflicts).toHaveLength(0);
    expect(result.sections.some((section) => section.heading === "Reported without a second account")).toBe(true);
    expect(result.summary.verifier).toBe("local");
    expect(result.summary.note).toMatch(/second model did not finish/i);
  });

  it("lists a repeated struck sentence once", () => {
    const text = "The pilots have already cut pack cost by 40 percent.";
    const draft = tagDraft({
      headline: "One Hamburg car posted a 612 km highway range",
      insufficient: false,
      lede: [{ text, kind: "fact", citations: ["p1"] }],
      sections: [{ heading: "Repeated", sentences: [{ text, kind: "fact", citations: ["p1"] }] }],
      conflicts: [],
      gaps: ["No price is reported.", "No price is reported.", "No  price is reported!"],
    });
    const result = adjudicate({
      draft,
      passages,
      modelVerdicts: null,
      mode: "live",
      modelError: null,
    });
    expect(result.summary.droppedSentences.filter((sentence) => sentence.text === text)).toHaveLength(1);
    expect(result.summary.dropped).toBe(1);
    expect(result.gaps.filter((gap) => gap.toLowerCase().includes("price"))).toHaveLength(1);
  });
});
