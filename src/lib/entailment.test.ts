import { describe, expect, it } from "vitest";
import { assessSupport } from "@/lib/entailment";
import { findSupportSpan, heuristicRewrite, nameInText, naturalizeSentence, offTopicReason, readablePublisher } from "@/lib/text";

const PASSAGE = "A Hamburg pilot of solid-state cells in a midsize passenger car reported a 612 km highway range at a constant 90 km/h, measured by the city's technical university on 28 October 2026.";

describe("assessSupport", () => {
  it("accepts a sentence grounded in the passage", () => {
    const result = assessSupport(
      "A Hamburg pilot of solid-state cells in a midsize passenger car reported a 612 km highway range at a constant 90 km/h.",
      [PASSAGE],
    );
    expect(result.level).toBe("supported");
  });

  it("rejects a figure the passage does not contain", () => {
    const result = assessSupport("The pilots have already cut pack cost by 40 percent.", [PASSAGE]);
    expect(result.level).toBe("unsupported");
    expect(result.reason).toMatch(/40%/);
  });

  it("rejects a name the passage does not contain", () => {
    const result = assessSupport("A Lisbon pilot reported the same highway range.", [PASSAGE]);
    expect(result.level).toBe("unsupported");
    expect(result.reason).toMatch(/Lisbon/);
  });

  it("flags a partial overlap", () => {
    const result = assessSupport("The Hamburg pilot reported wide public interest after the test.", [PASSAGE]);
    expect(result.level).toBe("partial");
  });

  it("keeps a sentence-initial Indonesian word that is not a name", () => {
    const passage = "Studi kohort tersebut menemukan konsumsi kopi harian tidak menaikkan risiko hipertensi pada orang dewasa.";
    const result = assessSupport(
      "Berdasarkan studi kohort tersebut, konsumsi kopi harian tidak menaikkan risiko hipertensi pada orang dewasa.",
      [passage],
    );
    expect(result.level).not.toBe("unsupported");
    expect(result.reason).not.toMatch(/Berdasarkan/);
  });

  it("accepts United States when the passage says U.S.", () => {
    const result = assessSupport(
      "A national poll in the United States found both highs for the sample.",
      ["A national poll in the U.S. found both highs for the sample."],
    );
    expect(result.level).toBe("supported");
  });

  it("matches Democratic House inside a longer party phrase", () => {
    expect(nameInText("Democratic House", "a Democratic Party win for the House")).toBe(true);
    const result = assessSupport(
      "The poll points to a Democratic House.",
      ["The poll describes a Democratic Party win for the House."],
    );
    expect(result.reason).not.toMatch(/Democratic House/);
    expect(result.level).not.toBe("unsupported");
  });

  it("strips parenthetical citation tags before looking for figures", () => {
    expect(naturalizeSentence("The highway range was 612 km (p7).")).toBe("The highway range was 612 km.");
    const result = assessSupport(
      "A Hamburg pilot reported a 612 km highway range (p7).",
      [PASSAGE],
    );
    expect(result.reason).not.toMatch(/figure 7/);
    expect(result.level).not.toBe("unsupported");
  });

  it("moves a foreign chess club out of a Bandung question", () => {
    const question = "Berapa kehadiran klub catur di perpustakaan Braga, Bandung?";
    expect(offTopicReason(question, "A Facebook post said about 17 people attended a library chess club in the United States.")).toBeTruthy();
    expect(offTopicReason(question, "Kingman and Downey public libraries host chess clubs.")).toBeTruthy();
    expect(offTopicReason(question, "Perpustakaan Braga di Bandung mengadakan klub catur.")).toBeNull();
  });

  it("turns health.detik.com into detikHealth", () => {
    expect(readablePublisher("health.detik.com")).toBe("detikHealth");
    expect(readablePublisher("Health detik")).toBe("detikHealth");
    expect(readablePublisher("prin.or.id", "Konsumsi kopi harian | Jurnal Kedokteran Komunitas")).toBe("Jurnal Kedokteran Komunitas");
  });

  it("ignores digits inside a hostname", () => {
    const result = assessSupport(
      "Jurnal di repository1.stikeselisabethmedan.ac.id dan jurnal2.globalhealthsciencegroup.com tidak menemukan kenaikan risiko hipertensi pada orang dewasa.",
      ["Studi kohort tidak menemukan kenaikan risiko hipertensi pada orang dewasa."],
    );
    expect(result.reason).not.toMatch(/figure/);
    expect(result.level).not.toBe("unsupported");
  });

  it("accepts 84 percent when the table cell is a bare 84", () => {
    const result = assessSupport(
      "The economy was the top issue for 84% of registered voters.",
      ["| Issue | Share |\n| --- | --- |\n| The economy | 84 |\n| Immigration | 61 |"],
    );
    expect(result.reason).not.toMatch(/figure 84/);
  });

  it("accepts a margin that is the gap in 52-45 or the word seven", () => {
    const fromRange = assessSupport(
      "The margin was 7 points.",
      ["The published horse race was 52-45."],
    );
    const fromWord = assessSupport(
      "The margin was 7 points.",
      ["The lead was a seven percentage point edge."],
    );
    expect(fromRange.reason).not.toMatch(/figure 7/);
    expect(fromWord.reason).not.toMatch(/figure 7/);
  });

  it("treats 26/27 and 2026/27 as the same season figure", () => {
    const result = assessSupport(
      "The 26/27 figure was 12 percent.",
      ["The 2026/27 figure was 12 percent."],
    );
    expect(result.level).not.toBe("unsupported");
    expect(result.reason).not.toMatch(/26/);
  });
});

describe("findSupportSpan", () => {
  it("highlights the shared clause", () => {
    const span = findSupportSpan(
      "A Hamburg pilot of solid-state cells in a midsize passenger car reported a 612 km highway range at a constant 90 km/h.",
      PASSAGE,
    );
    expect(span).not.toBeNull();
    expect(PASSAGE.slice(span!.start, span!.end).toLowerCase()).toContain("hamburg");
  });
});

describe("heuristicRewrite", () => {
  it("changes the query", () => {
    const next = heuristicRewrite("northglass audit score", "What happened in 2026?");
    expect(next.toLowerCase()).not.toBe("northglass audit score");
    expect(next).toMatch(/2026|report|source|evidence/);
  });
});
