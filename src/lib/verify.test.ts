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
  it("keeps a model-supported fact as partial instead of striking it", () => {
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
    const cost = result.lede.find((sentence) => sentence.text.includes("40"));
    expect(cost?.flag).toBe("partial");
    expect(result.summary.droppedSentences.some((sentence) => sentence.text.includes("40"))).toBe(false);
    expect(result.lede.some((sentence) => sentence.kind === "inference")).toBe(true);
  });

  it("still strikes an invented figure when the model verifier did not run", () => {
    const draft = tagDraft({
      headline: "One Hamburg car posted a 612 km highway range",
      insufficient: false,
      lede: [{ text: "The pilots have already cut pack cost by 40 percent.", kind: "fact", citations: ["p1"] }],
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
    expect(result.lede.some((sentence) => sentence.text.includes("40"))).toBe(false);
    expect(result.lede[0]?.citations).toContain("p1");
    expect(result.gaps.join(" ")).not.toMatch(/passage check/i);
    expect(result.summary.droppedSentences.some((sentence) => sentence.reason.includes("40%"))).toBe(true);
  });

  it("uses a sibling passage from the same page when the citation is the other chunk", () => {
    const page: Passage[] = [
      {
        id: "p9",
        url: "https://example.com/silver",
        title: "Numbers",
        publisher: "Silver Bulletin",
        publishedDate: "2026-10-01",
        origin: "extract",
        text: "The generic ballot stands at D +8.9 and D +9.2 among likely voters.",
      },
      {
        id: "p10",
        url: "https://example.com/silver",
        title: "Name",
        publisher: "Silver Bulletin",
        publishedDate: "2026-10-01",
        origin: "extract",
        text: "Silver Bulletin published the generic ballot on Monday.",
      },
    ];
    const draft = tagDraft({
      headline: "Silver Bulletin puts Democrats ahead",
      insufficient: false,
      lede: [{
        text: "Silver Bulletin puts the generic ballot at D +8.9 and D +9.2.",
        kind: "fact",
        citations: ["p10"],
      }],
      sections: [],
      conflicts: [],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: page,
      modelVerdicts: null,
      mode: "live",
      modelError: null,
    });
    expect(result.lede).toHaveLength(1);
    expect(result.lede[0]?.citations).toEqual(expect.arrayContaining(["p9", "p10"]));
    expect(result.summary.dropped).toBe(0);
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
    expect(result.lede.some((sentence) => sentence.text.includes("40"))).toBe(false);
    expect(result.lede[0]?.citations.length).toBeGreaterThan(0);
    expect(result.insufficient).toBe(true);
    expect(result.gaps.join(" ")).not.toMatch(/passage check/i);
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

  it("does not repeat a sentence under an Indonesian one-sided heading", () => {
    const shared = "A Hamburg pilot of solid-state cells in a midsize passenger car reported a 612 km highway range at a constant 90 km/h.";
    const draft = tagDraft({
      headline: "Satu mobil Hamburg mencatat jarak 612 km",
      insufficient: false,
      lede: [{ text: shared, kind: "fact", citations: ["p1"] }],
      sections: [],
      conflicts: [{
        topic: "Jarak",
        sides: [
          { label: "Jarak", sentences: [{ text: shared, kind: "fact", citations: ["p1"] }] },
          { label: "Biaya", sentences: [{ text: "The pilots have already cut pack cost by 40 percent.", kind: "fact", citations: ["p1"] }] },
        ],
      }],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages,
      modelVerdicts: null,
      mode: "live",
      modelError: null,
      language: "id",
    });
    expect(result.sections.some((section) => section.heading === "Yang tetap tercatat")).toBe(false);
    expect(result.lede.map((sentence) => sentence.text)).toContain(shared);
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
    expect(result.summary.droppedSentences.filter((sentence) => sentence.text.includes("40"))).toHaveLength(1);
    expect(result.summary.dropped).toBe(1);
    expect(result.gaps.filter((gap) => gap.toLowerCase().includes("price"))).toHaveLength(1);
  });

  it("moves an off-topic but true sentence out of the answer", () => {
    const draft = tagDraft({
      headline: "About 17 people attend the club",
      insufficient: false,
      lede: [{
        text: "A Facebook post said about 17 people attended a library chess club in the United States.",
        kind: "fact",
        citations: ["p1"],
      }],
      sections: [],
      conflicts: [],
      gaps: [],
    });
    const library: Passage[] = [{
      id: "p1",
      url: "https://example.com/facebook",
      title: "Chess night",
      publisher: "Facebook",
      publishedDate: null,
      origin: "extract",
      text: "A Facebook post said about 17 people attended a library chess club in the United States.",
    }];
    const result = adjudicate({
      draft,
      passages: library,
      modelVerdicts: [{ id: "s1", verdict: "supported", relevant: true, reason: "matches" }],
      mode: "live",
      modelError: null,
      language: "id",
      question: "Berapa kehadiran klub catur di perpustakaan Braga, Bandung?",
    });
    expect(result.lede.some((sentence) => sentence.text.includes("17"))).toBe(false);
    expect(result.lede[0]?.citations).toContain("p1");
    expect(result.lede[0]?.text).toMatch(/Facebook|Chess night/i);
    expect(result.lede[0]?.text).not.toMatch(/discusses|secara langsung/i);
    expect(result.aside).toHaveLength(1);
    expect(result.aside[0]?.text).toMatch(/17/);
    expect(result.aside[0]?.citations).toContain("p1");
    expect(result.insufficient).toBe(true);
    expect(result.headline).toMatch(/Braga/i);
    expect(result.headline).toMatch(/tidak ada sumber/i);
    expect(result.gaps.join(" ")).not.toMatch(/passage check|factual sentence remained/i);
    expect(result.summary.note).toMatch(/Model kedua/i);
  });

  it("moves a supported sentence the model marks irrelevant", () => {
    const draft = tagDraft({
      headline: "Braga employs dozens of people",
      insufficient: false,
      lede: [{
        text: "PT Braga Teknologi employs 40 people at its Bandung office.",
        kind: "fact",
        citations: ["p1"],
      }],
      sections: [],
      conflicts: [],
      gaps: [],
    });
    const library: Passage[] = [{
      id: "p1",
      url: "https://example.com/braga-tech",
      title: "Headcount",
      publisher: "PT Braga Teknologi",
      publishedDate: null,
      origin: "extract",
      text: "PT Braga Teknologi employs 40 people at its Bandung office.",
    }];
    const result = adjudicate({
      draft,
      passages: library,
      modelVerdicts: [{ id: "s1", verdict: "supported", relevant: false, reason: "company not library" }],
      mode: "live",
      modelError: null,
      question: "How many people attend the chess club at the Braga library in Bandung?",
    });
    expect(result.lede.some((sentence) => /40 people/.test(sentence.text))).toBe(false);
    expect(result.aside[0]?.text).toMatch(/40 people/);
    expect(result.aside[0]?.citations).toContain("p1");
  });

  it("shows both risk findings from two chunks of one journal", () => {
    const journal: Passage[] = [
      {
        id: "p7",
        url: "https://prin.or.id/kopi",
        title: "Konsumsi kopi | Jurnal Kedokteran Komunitas",
        publisher: "prin.or.id",
        publishedDate: null,
        origin: "extract",
        text: "Shah et al. found that more than 2 cups a day were linked to a lower risk of hypertension.",
      },
      {
        id: "p8",
        url: "https://prin.or.id/kopi",
        title: "Konsumsi kopi | Jurnal Kedokteran Komunitas",
        publisher: "prin.or.id",
        publishedDate: null,
        origin: "extract",
        text: "Lebih dari 2 cangkir per hari dapat meningkatkan faktor risiko hipertensi.",
      },
    ];
    const draft = tagDraft({
      headline: "Kopi dan risiko hipertensi",
      insufficient: false,
      lede: [{
        text: "Lebih dari 2 cangkir per hari dapat meningkatkan faktor risiko hipertensi.",
        kind: "fact",
        citations: ["p8"],
      }],
      sections: [],
      conflicts: [],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: journal,
      modelVerdicts: [{ id: "s1", verdict: "supported", relevant: true, reason: "matches" }],
      mode: "live",
      modelError: null,
      language: "id",
      question: "Apakah lebih dari 2 cangkir kopi sehari menaikkan risiko hipertensi?",
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.sides).toHaveLength(2);
    expect(result.conflicts[0]?.topic).toMatch(/berlawanan/i);
    const sideText = result.conflicts[0]?.sides.map((side) => side.sentences.map((sentence) => sentence.text).join(" ")).join(" ") ?? "";
    expect(sideText).not.toMatch(/Shah et al/);
    expect(sideText).not.toContain("dapat meningkatkan faktor risiko hipertensi");
    expect(sideText).toMatch(/lebih tinggi/);
    expect(sideText).toMatch(/lebih rendah/);
  });

  it("keeps a publisher named only in the title or URL", () => {
    const pages: Passage[] = [{
      id: "p3",
      url: "https://repository.undip.ac.id/kopi",
      title: "Jurnal LPPM Stikesfa",
      publisher: "Repositori Undip",
      publishedDate: null,
      origin: "extract",
      text: "Risiko hipertensi sekitar 4 kali lebih tinggi pada kelompok tersebut.",
    }];
    const draft = tagDraft({
      headline: "Risiko sekitar empat kali lipat",
      insufficient: false,
      lede: [{
        text: "Jurnal LPPM Stikesfa dan Repositori Undip melaporkan risiko sekitar 4 kali lebih tinggi.",
        kind: "fact",
        citations: ["p3"],
      }],
      sections: [],
      conflicts: [],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: null,
      mode: "live",
      modelError: null,
      language: "id",
      question: "Berapa kali kopi menaikkan risiko hipertensi?",
    });
    expect(result.summary.dropped).toBe(0);
    expect(result.lede.map((sentence) => sentence.text).join(" ")).toMatch(/LPPM Stikesfa/);
    expect(result.lede[0]?.citations).toContain("p3");
  });

  it("softens a disagreement headline when the opposing side is gone", () => {
    const pages: Passage[] = [{
      id: "p8",
      url: "https://prin.or.id/kopi-naik",
      title: "Kopi",
      publisher: "Jurnal",
      publishedDate: null,
      origin: "extract",
      text: "Lebih dari 2 cangkir per hari dapat meningkatkan faktor risiko hipertensi.",
    }];
    const kept = "Lebih dari 2 cangkir per hari dapat meningkatkan faktor risiko hipertensi.";
    const draft = tagDraft({
      headline: "Bukti saling bertentangan soal kopi",
      insufficient: false,
      lede: [{ text: kept, kind: "fact", citations: ["p8"] }],
      sections: [],
      conflicts: [{
        topic: "Risiko",
        sides: [
          { label: "Naik", sentences: [{ text: kept, kind: "fact", citations: ["p8"] }] },
          { label: "Turun", sentences: [{ text: "Risiko turun 40 persen pada semua orang.", kind: "fact", citations: ["p8"] }] },
        ],
      }],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: null,
      mode: "live",
      modelError: null,
      language: "id",
      question: "Apakah kopi menaikkan risiko hipertensi?",
    });
    expect(result.conflicts).toHaveLength(0);
    expect(result.headline).not.toMatch(/bertentangan/i);
    expect(result.headline).toMatch(/tidak menetapkan/i);
    expect(result.lede.map((sentence) => sentence.text)).toContain(kept);
  });

  it("keeps the disagree box when retained passages still conflict", () => {
    const journal: Passage[] = [
      {
        id: "p7",
        url: "https://prin.or.id/kopi",
        title: "Konsumsi kopi | Jurnal Kedokteran Komunitas",
        publisher: "prin.or.id",
        publishedDate: null,
        origin: "extract",
        text: "Shah et al. found that more than 2 cups a day were linked to a lower risk of hypertension.",
      },
      {
        id: "p8",
        url: "https://prin.or.id/kopi",
        title: "Konsumsi kopi | Jurnal Kedokteran Komunitas",
        publisher: "prin.or.id",
        publishedDate: null,
        origin: "extract",
        text: "Lebih dari 2 cangkir per hari dapat meningkatkan faktor risiko hipertensi.",
      },
    ];
    const draft = tagDraft({
      headline: "Bukti saling bertentangan soal kopi",
      insufficient: false,
      lede: [{
        text: "Lebih dari 2 cangkir per hari dapat meningkatkan faktor risiko hipertensi.",
        kind: "fact",
        citations: ["p8"],
      }],
      sections: [],
      conflicts: [{
        topic: "Risiko",
        sides: [
          {
            label: "Naik",
            sentences: [{
              text: "Lebih dari 2 cangkir per hari dapat meningkatkan faktor risiko hipertensi.",
              kind: "fact",
              citations: ["p8"],
            }],
          },
          {
            label: "Turun",
            sentences: [{ text: "Risiko turun 40 persen pada semua orang.", kind: "fact", citations: ["p8"] }],
          },
        ],
      }],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: journal,
      modelVerdicts: [{ id: "s1", verdict: "supported", relevant: true, reason: "matches" }],
      mode: "live",
      modelError: null,
      language: "id",
      question: "Apakah lebih dari 2 cangkir kopi sehari menaikkan risiko hipertensi?",
    });
    expect(result.conflicts.some((conflict) => conflict.sides.length >= 2)).toBe(true);
    expect(result.headline).toMatch(/bertentangan/i);
  });

  it("keeps an on-topic adherence sentence, with its citation, in the answer", () => {
    const pages: Passage[] = [{
      id: "p6",
      url: "https://ithy.com/kopi",
      title: "Pola 4:3",
      publisher: "Ithy",
      publishedDate: null,
      origin: "extract",
      text: "Ithy menulis bahwa keunggulan pola 4:3 mungkin berasal dari kepatuhan pada konsumsi kopi dan risiko hipertensi.",
    }];
    const claim = "Ithy menulis bahwa keunggulan pola 4:3 mungkin berasal dari kepatuhan.";
    const draft = tagDraft({
      headline: "Pola 4:3 mungkin unggul karena kepatuhan",
      insufficient: false,
      lede: [{ text: claim, kind: "fact", citations: ["p6"] }],
      sections: [],
      conflicts: [],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: [{ id: "s1", verdict: "supported", relevant: false, reason: "adherence aside" }],
      mode: "live",
      modelError: null,
      language: "id",
      question: "Apakah konsumsi kopi rutin menurunkan risiko hipertensi?",
    });
    const kept = result.lede.find((sentence) => sentence.text.includes("4:3"));
    expect(kept?.citations).toContain("p6");
    expect(result.aside.some((sentence) => sentence.text.includes("4:3"))).toBe(false);
  });

  it("keeps an absence statement that names a place missing from the passage", () => {
    const pages: Passage[] = [{
      id: "p1",
      url: "https://facebook.com/massillonlibrary/posts/1",
      title: "Chess night",
      publisher: "Facebook",
      publishedDate: null,
      origin: "extract",
      text: "The club meets on Thursdays at the branch.",
    }];
    const draft = tagDraft({
      headline: "Tidak ada angka kehadiran di perpustakaan Braga",
      insufficient: true,
      lede: [{
        text: "None of the stored sources gives an attendance figure for the chess club at the Braga public library.",
        kind: "fact",
        citations: ["p1"],
      }],
      sections: [],
      conflicts: [],
      gaps: ["No attendance count was published."],
    });
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: null,
      mode: "live",
      modelError: null,
      language: "en",
      question: "How many people attend the chess club at the Braga public library?",
    });
    expect(result.summary.dropped).toBe(0);
    expect(result.lede.map((sentence) => sentence.text).join(" ")).toMatch(/Braga public library/);
    expect(result.headline).toMatch(/perpustakaan Braga|Braga public library|Tidak ada angka/i);
  });

  it("matches a library name to the URL slug", () => {
    const pages: Passage[] = [{
      id: "p4",
      url: "https://www.facebook.com/massillonlibrary/posts/9",
      title: "Thursday club",
      publisher: "Facebook",
      publishedDate: null,
      origin: "extract",
      text: "The club meets on Thursdays at the branch.",
    }];
    const claim = "The Facebook post from Massillon Public Library said the club meets on Thursdays.";
    const draft = tagDraft({
      headline: "The club meets on Thursdays",
      insufficient: false,
      lede: [{ text: claim, kind: "fact", citations: ["p4"] }],
      sections: [],
      conflicts: [],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: [{ id: "s1", verdict: "supported", relevant: true, reason: "matches" }],
      mode: "live",
      modelError: null,
      question: "When does the Massillon Public Library chess club meet?",
    });
    expect(result.summary.droppedSentences.some((sentence) => /Massillon/i.test(sentence.reason))).toBe(false);
    expect(result.lede.map((sentence) => sentence.text).join(" ")).toMatch(/Massillon Public Library/);
  });

  it("treats a verbatim sentence as supported even when the model dissents", () => {
    const pages: Passage[] = [{
      id: "p9",
      url: "https://example.com/kalshi",
      title: "Senate market",
      publisher: "Kalshi",
      publishedDate: null,
      origin: "extract",
      text: "Kalshi showed 61 percent favoring a Republican Senate win.",
    }];
    const claim = "Kalshi showed 61 percent favoring a Republican Senate win.";
    const draft = tagDraft({
      headline: "Kalshi favors a Republican Senate",
      insufficient: false,
      lede: [{ text: claim, kind: "fact", citations: ["p9"] }],
      sections: [],
      conflicts: [],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: [{ id: "s1", verdict: "partial", reason: "narrow" }],
      mode: "live",
      modelError: null,
      question: "Who does Kalshi favor in the Senate?",
    });
    const kept = result.lede.find((sentence) => sentence.text.includes("61"));
    expect(kept).toBeTruthy();
    expect(kept?.flag).toBeUndefined();
  });

  it("drops a margin sentence that only restates a published pair", () => {
    const pages: Passage[] = [{
      id: "p2",
      url: "https://www.nytimes.com/siena",
      title: "NYT/Siena poll",
      publisher: "nytimes.com",
      publishedDate: null,
      origin: "extract",
      text: "The NYT/Siena poll found Democrats ahead of Republicans 52 to 41, a lead of 11 percentage points.",
    }];
    const draft = tagDraft({
      headline: "NYT/Siena has Democrats ahead",
      insufficient: false,
      lede: [
        { text: "The NYT/Siena poll found Democrats ahead of Republicans 52 to 41.", kind: "fact", citations: ["p2"] },
        { text: "The lead is 11 percentage points.", kind: "fact", citations: ["p2"] },
      ],
      sections: [],
      conflicts: [],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: null,
      mode: "live",
      modelError: null,
      question: "What is the NYT/Siena margin?",
    });
    expect(result.lede.some((sentence) => sentence.text.includes("52"))).toBe(true);
    expect(result.lede.some((sentence) => sentence.text.includes("11"))).toBe(false);
  });

  it("summarizes a disagreement side that repeats the opening", () => {
    const opening = "Grid operator notes released that afternoon attributed the 9 September 2026 disturbance to a transformer fire at the Caceres substation, and the operator called the fire the start of the outage.";
    const other = "A separate engineering memo argued the disturbance began with a frequency trip in a cluster of solar inverters in Alentejo, and that the Caceres fire was a consequence rather than the trigger.";
    const draft = tagDraft({
      headline: "Reports do not agree on the Iberian grid trigger",
      insufficient: false,
      lede: [{ text: opening, kind: "fact", citations: ["p1"] }],
      sections: [],
      conflicts: [{
        topic: "Trigger",
        sides: [
          { label: "Fire", sentences: [{ text: opening, kind: "fact", citations: ["p1"] }] },
          { label: "Inverters", sentences: [{ text: other, kind: "fact", citations: ["p2"] }] },
        ],
      }],
      gaps: [],
    });
    const pages: Passage[] = [
      { id: "p1", url: "https://example.com/fire", title: "Fire", publisher: "Iberian Dispatch", publishedDate: null, origin: "extract", text: opening },
      { id: "p2", url: "https://example.com/memo", title: "Memo", publisher: "Peninsula Power Review", publishedDate: null, origin: "extract", text: other },
    ];
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: null,
      mode: "live",
      modelError: null,
      question: "What triggered the Iberian grid disturbance?",
    });
    const fire = result.conflicts[0]?.sides.find((side) => side.label === "Fire")?.sentences[0];
    expect(fire?.citations).toContain("p1");
    expect(fire?.text.length).toBeLessThan(opening.length);
    expect(fire?.text).not.toBe(opening);
  });

  it("keeps a paraphrased odds sentence and does not call it a struck second account", () => {
    const pages: Passage[] = [{
      id: "p9",
      url: "https://www.phillyburbs.com/kalshi",
      title: "Senate odds",
      publisher: "PhillyBurbs",
      publishedDate: null,
      origin: "extract",
      text: "Kalshi priced the race at 61% favor a Republican Party win for the Senate in the midterms 2026.",
    }, {
      id: "p10",
      url: "https://example.com/other-poll",
      title: "Other poll",
      publisher: "Other Desk",
      publishedDate: null,
      origin: "extract",
      text: "A second desk put the same Republican Senate chance at 58 percent.",
    }];
    const draft = tagDraft({
      headline: "Markets favor a Republican Senate",
      insufficient: false,
      lede: [],
      sections: [],
      conflicts: [{
        topic: "Senate odds",
        sides: [
          {
            label: "Kalshi",
            sentences: [{
              text: "PhillyBurbs reported Kalshi odds of 61% favoring a Republican Senate win.",
              kind: "fact",
              citations: ["p9"],
            }],
          },
          {
            label: "Other desk",
            sentences: [{
              text: "A second desk put the same Republican Senate chance at 58 percent.",
              kind: "fact",
              citations: ["p10"],
            }],
          },
        ],
      }],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: [
        { id: "s1", verdict: "unsupported", reason: "wording differs" },
        { id: "s2", verdict: "supported", reason: "matches" },
      ],
      mode: "live",
      modelError: null,
      question: "What chance do the markets give a Republican Senate win?",
    });
    expect(result.summary.dropped).toBe(0);
    expect(result.conflicts.some((conflict) => conflict.sides.length >= 2)).toBe(true);
    expect(result.gaps.join(" ")).not.toMatch(/second account|dicoret/i);
    const odds = result.conflicts.flatMap((conflict) => conflict.sides.flatMap((side) => side.sentences)).find((sentence) => sentence.text.includes("61"));
    expect(odds?.flag).toBeUndefined();
  });

  it("does not park a site-rank sentence in what we found instead", () => {
    const pages: Passage[] = [{
      id: "p1",
      url: "https://example.com/braga-tech",
      title: "Company profile",
      publisher: "Example",
      publishedDate: null,
      origin: "extract",
      text: "PT Braga Teknologi lists a global rank of 7880232.",
    }];
    const draft = tagDraft({
      headline: "Attendance is not reported",
      insufficient: true,
      lede: [{
        text: "PT Braga Teknologi lists a global rank of 7,880,232.",
        kind: "fact",
        citations: ["p1"],
      }],
      sections: [],
      conflicts: [],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: [{ id: "s1", verdict: "supported", relevant: false, reason: "company profile" }],
      mode: "live",
      modelError: null,
      question: "How many people attend the chess club at the Braga library?",
    });
    expect(result.aside.some((sentence) => /rank|7,880,232|7880232/.test(sentence.text))).toBe(false);
    expect(result.lede.some((sentence) => /rank|7,880,232/.test(sentence.text))).toBe(false);
  });

  it("parks off-topic nearest-source facts in the aside when evidence is insufficient", () => {
    const pages: Passage[] = [
      {
        id: "p1",
        url: "https://en.wikipedia.org/wiki/Vital_articles",
        title: "Vital articles",
        publisher: "Wikipedia",
        publishedDate: null,
        origin: "extract",
        text: "The vital-articles list names Braga and Bandung among its geography entries.",
      },
      {
        id: "p2",
        url: "https://example.com/braga-it",
        title: "Company",
        publisher: "Example",
        publishedDate: null,
        origin: "extract",
        text: "The Braga IT company reports a headcount of 59.",
      },
      {
        id: "p3",
        url: "https://www.myfonts.com/fonts/braga",
        title: "Athletic lettering faces",
        publisher: "Athletic lettering faces",
        publishedDate: null,
        origin: "extract",
        text: "Braga and Braga Huis are typefaces in this family.",
      },
    ];
    const draft = tagDraft({
      headline: "Tidak ada angka kehadiran di perpustakaan Braga",
      insufficient: true,
      lede: [{
        text: "None of the stored sources gives an attendance figure for the chess club at the Braga public library.",
        kind: "fact",
        citations: ["p1"],
      }],
      sections: [{
        heading: "What the nearest sources cover",
        sentences: [
          { text: "The vital-articles list names Braga and Bandung among its geography entries.", kind: "fact", citations: ["p1"] },
          { text: "The Braga IT company reports a headcount of 59.", kind: "fact", citations: ["p2"] },
          { text: "Braga and Braga Huis are typefaces in this family.", kind: "fact", citations: ["p3"] },
        ],
      }],
      conflicts: [],
      gaps: ["No attendance count was published."],
    });
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: [
        { id: "s1", verdict: "supported", relevant: true, reason: "gap" },
        { id: "s2", verdict: "supported", relevant: true, reason: "list" },
        { id: "s3", verdict: "supported", relevant: true, reason: "headcount" },
        { id: "s4", verdict: "supported", relevant: true, reason: "font" },
      ],
      mode: "live",
      modelError: null,
      language: "id",
      question: "Berapa kehadiran klub catur di perpustakaan Braga, Bandung?",
    });
    const body = [...result.lede, ...result.sections.flatMap((section) => section.sentences)].map((sentence) => sentence.text).join(" ");
    expect(result.sections).toHaveLength(0);
    expect(body).not.toMatch(/vital-articles|headcount|typefaces/i);
    expect(body).toMatch(/attendance figure|Braga public library/i);
    expect(result.aside.map((sentence) => sentence.text).join(" ")).toMatch(/headcount/);
    expect(result.aside.map((sentence) => sentence.text).join(" ")).toMatch(/typefaces/);
  });

  it("keeps both survey figures in a disagreement side", () => {
    const full = "Pew found that 46% of all U.S. adults expected Democrats to win the Senate and 48% expected Republicans.";
    const pages: Passage[] = [{
      id: "p1",
      url: "https://www.pewresearch.org/senate",
      title: "Expectations",
      publisher: "Pew Research Center",
      publishedDate: null,
      origin: "extract",
      text: full,
    }, {
      id: "p2",
      url: "https://www.example.com/other-poll",
      title: "Other poll",
      publisher: "Other Poll",
      publishedDate: null,
      origin: "extract",
      text: "Another national survey found 51% of adults expected Republicans to win the Senate and 44% expected Democrats.",
    }];
    const draft = tagDraft({
      headline: "Surveys split on the Senate",
      insufficient: false,
      lede: [{ text: full, kind: "fact", citations: ["p1"] }],
      sections: [],
      conflicts: [{
        topic: "Who adults expect to win the Senate",
        sides: [
          { label: "Pew", sentences: [{ text: full, kind: "fact", citations: ["p1"] }] },
          { label: "Other poll", sentences: [{ text: "Another national survey found 51% of adults expected Republicans to win the Senate and 44% expected Democrats.", kind: "fact", citations: ["p2"] }] },
        ],
      }],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: null,
      mode: "live",
      modelError: null,
      question: "Who do U.S. adults expect to win the Senate?",
    });
    const pew = result.conflicts.flatMap((conflict) => conflict.sides).find((side) => side.label === "Pew")?.sentences[0]?.text ?? "";
    expect(pew).toMatch(/46%/);
    expect(pew).toMatch(/48%/);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it("omits a disagreement that pairs a survey with betting odds", () => {
    const pages: Passage[] = [{
      id: "p1",
      url: "https://www.pewresearch.org/senate",
      title: "Expectations",
      publisher: "Pew Research Center",
      publishedDate: null,
      origin: "extract",
      text: "Pew found that 46% of adults expected Democrats to win the Senate.",
    }, {
      id: "p9",
      url: "https://kalshi.com/senate",
      title: "Odds",
      publisher: "Kalshi",
      publishedDate: null,
      origin: "extract",
      text: "Kalshi showed 61% favoring a Republican Senate win.",
    }];
    const draft = tagDraft({
      headline: "Surveys split on the Senate",
      insufficient: false,
      lede: [{ text: "Pew found that 46% of adults expected Democrats to win the Senate.", kind: "fact", citations: ["p1"] }],
      sections: [],
      conflicts: [{
        topic: "Senate outlook",
        sides: [
          { label: "Pew", sentences: [{ text: "Pew found that 46% of adults expected Democrats to win the Senate.", kind: "fact", citations: ["p1"] }] },
          { label: "Kalshi", sentences: [{ text: "Kalshi showed 61% favoring a Republican Senate win.", kind: "fact", citations: ["p9"] }] },
        ],
      }],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: null,
      mode: "live",
      modelError: null,
      question: "Who is favored to win the Senate?",
    });
    expect(result.conflicts).toHaveLength(0);
  });

  it("keeps a little-difference label attached to the full finding", () => {
    const finding = "The trial finds little difference at one year, though early months showed significantly greater weight loss, and the advantage was largely gone beyond six months.";
    const other = "A second trial reported significantly greater weight loss that remained at one year.";
    const pages: Passage[] = [{
      id: "p1",
      url: "https://example.com/trial-a",
      title: "Trial A",
      publisher: "Journal A",
      publishedDate: null,
      origin: "extract",
      text: finding,
    }, {
      id: "p2",
      url: "https://example.com/trial-b",
      title: "Trial B",
      publisher: "Journal B",
      publishedDate: null,
      origin: "extract",
      text: other,
    }];
    const draft = tagDraft({
      headline: "Satu studi menunjukkan penurunan berat badan",
      insufficient: false,
      lede: [{ text: finding, kind: "fact", citations: ["p1"] }],
      sections: [{ heading: "Uji pertama", sentences: [{ text: finding, kind: "fact", citations: ["p1"] }] }],
      conflicts: [{
        topic: "Weight loss",
        sides: [
          { label: "Finds little difference", sentences: [{ text: finding, kind: "fact", citations: ["p1"] }] },
          { label: "Greater loss remains", sentences: [{ text: other, kind: "fact", citations: ["p2"] }] },
        ],
      }],
      gaps: [],
    });
    const result = adjudicate({
      draft,
      passages: pages,
      modelVerdicts: null,
      mode: "live",
      modelError: null,
      language: "id",
      question: "Apakah pola makan itu menurunkan berat badan?",
    });
    const side = result.conflicts.flatMap((conflict) => conflict.sides).find((item) => item.label === "Finds little difference");
    expect(side?.sentences[0]?.text).toMatch(/little difference/i);
    expect(side?.sentences[0]?.text).not.toMatch(/^significantly greater/i);
    expect(result.headline).toBe("Bukti beragam soal weight loss");
  });
});
