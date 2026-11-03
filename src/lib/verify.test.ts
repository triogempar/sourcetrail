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
    expect(result.aside).toHaveLength(1);
    expect(result.aside[0]?.text).toMatch(/17/);
    expect(result.aside[0]?.citations).toContain("p1");
    expect(result.insufficient).toBe(true);
    expect(result.headline).toMatch(/tidak menjawab/i);
    expect(result.gaps.join(" ")).not.toMatch(/passage check|factual sentence remained/i);
    expect(result.gaps.join(" ")).toMatch(/halaman terdekat/i);
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
});
