import { describe, expect, it } from "vitest";
import { assessSupport } from "@/lib/entailment";
import { findSupportSpan, heuristicRewrite, nameInText, naturalizeSentence, isSlugPublisher, offTopicReason, planFrameDetail, readablePublisher, scrubSlugName } from "@/lib/text";

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
    expect(readablePublisher("withpower.com")).toBe("WithPower");
    expect(readablePublisher("Power", "Pengaruh Konsumsi Kopi Terhadap Peningkatan Tekanan ...", "https://www.withpower.com/study")).toBe("WithPower");
    expect(readablePublisher("nytimes.com")).toBe("New York Times");
    expect(readablePublisher("livenowfox.com")).toBe("Fox");
    expect(readablePublisher("cuanschutz.edu")).toBe("CU Anschutz");
    expect(readablePublisher("www.frontiersin.org")).toBe("Frontiers");
    expect(readablePublisher("stikesfa.ac.id", "Pengaruh Konsumsi Kopi Terhadap Peningkatan Tekanan ...")).toBe("LPPM Stikesfa");
    expect(readablePublisher("Pengaruh Konsumsi Kopi Terhadap Peningkatan Tekanan ...", undefined, "https://ejournal.stikesfa.ac.id/index.php/kopi")).toBe("LPPM Stikesfa");
    expect(naturalizeSentence("Jurnal Lppm-stikesfa juga mencatat risiko yang sama.")).toContain("LPPM Stikesfa");
    for (const [host, brand] of [
      ["yahoo.com", "Yahoo"],
      ["medium.com", "Medium"],
      ["mdpi.com", "MDPI"],
      ["ctv.veeva.com", "Veeva"],
      ["diagnos.co.id", "Diagnos"],
      ["stikeselisabethmedan.ac.id", "STIKes Elisabeth Medan"],
    ] as const) {
      expect(readablePublisher(host)).toBe(brand);
      expect(readablePublisher("Source", undefined, `https://${host}/story`)).toBe(brand);
    }
    expect(naturalizeSentence("Sumber diagnos.co.id juga mencatat angka yang sama.")).toBe("Sumber Diagnos juga mencatat angka yang sama.");
    expect(readablePublisher("Athletic lettering faces", "Athletic lettering faces", "https://www.myfonts.com/fonts/braga")).toBe("Myfonts");
    expect(readablePublisher("cookpolitical.com")).toBe("Cook Political Report");
    expect(readablePublisher("theconversation.com")).toBe("The Conversation");
    expect(readablePublisher("poltekkesjakarta1.ac.id")).toBe("Poltekkes Jakarta I");
    expect(readablePublisher("www.heart.org")).toBe("American Heart Association");
    expect(readablePublisher("nbcnews.com")).toBe("NBC News");
    expect(readablePublisher("Tavily", "Senate poll", "https://www.nbcnews.com/politics/senate")).toBe("NBC News");
    expect(readablePublisher("ithy.com")).toBe("Ithy");
    expect(readablePublisher("medicalxpress.com")).toBe("Medical Xpress");
    expect(readablePublisher("sciencedirect.com")).toBe("ScienceDirect");
    expect(readablePublisher("mychess.events")).toBe("MyChess Events");
    expect(readablePublisher("Tavily", "House poll", "https://www.pewresearch.org/politics/2026/house")).toBe("Pew Research Center");
    expect(readablePublisher("Northjersey")).toBe("NorthJersey.com");
    expect(readablePublisher("Pewresearch")).toBe("Pew Research Center");
    expect(readablePublisher("Tavily", "Midterms", "https://www.northjersey.com/story/news/2026")).toBe("NorthJersey.com");
    expect(readablePublisher("Tavily", "Midterm odds", "https://www.ms.now/news/midterms")).toBe("MS NOW");
    expect(naturalizeSentence("Northjersey reported Democrats lead by 7 points.")).toBe("NorthJersey.com reported Democrats lead by 7 points.");
    expect(isSlugPublisher("Northjersey")).toBe(true);
    expect(isSlugPublisher("Examplenews")).toBe(true);
    expect(isSlugPublisher("Medium")).toBe(false);
    expect(scrubSlugName("Examplenews reported Democrats lead by 7 points.", "Examplenews")).toBe("Democrats lead by 7 points.");
    expect(scrubSlugName("Democrats lead by 7 points, according to Examplenews.", "Examplenews")).toBe("Democrats lead by 7 points.");
    expect(planFrameDetail("id", 4)).toBe("4 jalur pertanyaan. Bahasa: id.");
  });

  it("treats matching figures and names as supported when the verb is paraphrased", () => {
    const senate = assessSupport(
      "PhillyBurbs reported Kalshi odds of 61% favoring a Republican Senate win.",
      ["Kalshi priced the race at 61% favor a Republican Party win for the Senate in the midterms 2026."],
      "PhillyBurbs https://www.phillyburbs.com/kalshi",
    );
    const markets = assessSupport(
      "Polymarket showed 91% and Kalshi at 90%.",
      ["Polymarket 91%. Kalshi at 90%."],
    );
    const campus = assessSupport(
      "CU Anschutz reported 7.6% versus 5%.",
      ["CU Anschutz recorded 7.6% vs 5% in the same cohort."],
    );
    expect(senate.level).toBe("supported");
    expect(markets.level).toBe("supported");
    expect(campus.level).toBe("supported");
  });

  it("keeps a missing-evidence sentence that names a place the passage lacks", () => {
    const result = assessSupport(
      "None of the stored sources gives an attendance figure for the chess club at the Braga public library.",
      ["The club meets on Thursdays at the branch."],
    );
    expect(result.level).toBe("supported");
    expect(result.reason).not.toMatch(/Braga/);
  });

  it("reads Massillon Public Library from a facebook slug", () => {
    expect(nameInText("Massillon Public Library", "https://www.facebook.com/massillonlibrary/posts/9")).toBe(true);
    const result = assessSupport(
      "The Facebook post from Massillon Public Library said the club meets on Thursdays.",
      ["The club meets on Thursdays at the branch."],
      "https://www.facebook.com/massillonlibrary/posts/9 Facebook",
    );
    expect(result.reason).not.toMatch(/Massillon/);
    expect(result.level).not.toBe("unsupported");
  });

  it("accepts a figure that appears in the page title", () => {
    const result = assessSupport(
      "The Reuters/Ipsos poll found Democrats holding a 9-point edge.",
      ["Democrats hold 9-point edge in the Reuters/Ipsos poll", "The poll described the race among likely voters."],
    );
    expect(result.reason).not.toMatch(/figure 9/);
    expect(result.level).not.toBe("unsupported");
  });

  it("accepts a sentence copied from the passage", () => {
    const result = assessSupport(
      "Kalshi showed 61 percent favoring a Republican Senate win.",
      ["Kalshi showed 61% favoring a Republican Senate win."],
    );
    expect(result.level).toBe("supported");
  });

  it("accepts a publisher name that lives in the title or URL", () => {
    const result = assessSupport(
      "Jurnal LPPM Stikesfa dan Repositori Undip melaporkan risiko sekitar 4 kali lebih tinggi.",
      ["Risiko hipertensi sekitar 4 kali lebih tinggi pada kelompok tersebut."],
      "Jurnal LPPM Stikesfa https://repository.undip.ac.id/kopi Repositori Undip",
    );
    expect(result.reason).not.toMatch(/LPPM Stikesfa|Repositori Undip/);
    expect(result.level).not.toBe("unsupported");
  });

  it("flags routine coffee when the source only compared a dose", () => {
    const widened = assessSupport(
      "Diagnos dan Jurnal JIG melaporkan risiko hipertensi yang lebih rendah pada konsumsi kopi rutin.",
      ["Jurnal JIG melaporkan risiko hipertensi lebih rendah pada konsumsi lebih dari 2 cangkir per hari dibanding 2 cangkir atau kurang."],
    );
    const scoped = assessSupport(
      "Jurnal JIG melaporkan risiko hipertensi lebih rendah pada konsumsi lebih dari 2 cangkir per hari.",
      ["Jurnal JIG melaporkan risiko hipertensi lebih rendah pada konsumsi lebih dari 2 cangkir per hari dibanding 2 cangkir atau kurang."],
    );
    expect(widened.level).toBe("partial");
    expect(widened.reason).toMatch(/narrower comparison/);
    expect(scoped.reason).not.toMatch(/narrower comparison/);
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
