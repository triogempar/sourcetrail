import { appearsVerbatim, assessSupport } from "@/lib/entailment";
import { isSiteStat } from "@/lib/passages";
import type { ModelVerdict } from "@/lib/schema";
import { canonicalUrl, cleanHeadline, cleanSentence, clip, contentWords, loneAccountHeading, nameInText, naturalizeSentence, numberSatisfied, numberTokens, offTopicReason, properNouns, subjectOverlap, uniqueGaps } from "@/lib/text";
import type { DraftBrief, DraftSentence, Passage, Sentence, VerificationSummary } from "@/lib/types";

export type WorkingSentence = DraftSentence & { id: string };

export type WorkingBrief = {
  headline: string;
  insufficient: boolean;
  lede: WorkingSentence[];
  sections: { heading: string; sentences: WorkingSentence[] }[];
  conflicts: { topic: string; sides: { label: string; sentences: WorkingSentence[] }[] }[];
  gaps: string[];
};

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function tagDraft(draft: DraftBrief): WorkingBrief {
  let count = 0;
  const tag = (sentence: DraftSentence): WorkingSentence => {
    count += 1;
    return {
      id: `s${count}`,
      text: naturalizeSentence(cleanSentence(sentence.text)),
      kind: sentence.kind,
      citations: dedupe(sentence.citations),
    };
  };
  return {
    headline: clip(cleanHeadline(draft.headline), 180) || "Research brief",
    insufficient: draft.insufficient,
    lede: draft.lede.map(tag),
    sections: draft.sections.map((section) => ({
      heading: clip(cleanSentence(section.heading), 120) || "Notes",
      sentences: section.sentences.map(tag),
    })),
    conflicts: draft.conflicts
      .map((conflict) => ({
        topic: clip(cleanSentence(conflict.topic), 160) || "Disagreement",
        sides: conflict.sides
          .map((side) => ({
            label: clip(cleanSentence(side.label), 80) || "Account",
            sentences: side.sentences.map(tag),
          }))
          .filter((side) => side.sentences.length > 0),
      }))
      .filter((conflict) => conflict.sides.length >= 2),
    gaps: uniqueGaps(draft.gaps.map((gap) => clip(cleanSentence(gap), 320))),
  };
}

export function listWorkingSentences(brief: WorkingBrief): WorkingSentence[] {
  return [
    ...brief.lede,
    ...brief.sections.flatMap((section) => section.sentences),
    ...brief.conflicts.flatMap((conflict) => conflict.sides.flatMap((side) => side.sentences)),
  ];
}

type Judgement = {
  action: "keep" | "flag" | "drop" | "aside";
  reason: string;
};

function familyIds(citations: string[], passages: Passage[]): string[] {
  const urls = new Set<string>();
  for (const id of citations) {
    const passage = passages.find((item) => item.id === id);
    if (passage) urls.add(canonicalUrl(passage.url));
  }
  if (urls.size === 0) return citations;
  const ids = passages.filter((passage) => urls.has(canonicalUrl(passage.url))).map((passage) => passage.id);
  return ids.length > 0 ? ids : citations;
}

function evidenceTexts(citations: string[], passages: Passage[]): string[] {
  return familyIds(citations, passages)
    .map((id) => passages.find((passage) => passage.id === id)?.text)
    .filter((text): text is string => Boolean(text));
}

function sourceMetadata(passages: Passage[]): string {
  return passages.map((passage) => {
    const site = `${passage.publisher} ${passage.title} ${passage.url}`
      .replace(/repository/gi, "repository repositori")
      .replace(/\bjournals?\b/gi, "journal jurnal");
    return site;
  }).join("\n");
}

function claimKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}.+%]+/gu, " ").replace(/\s+/g, " ").trim();
}

function soften(reason: string, model: ModelVerdict["verdict"] | undefined): Judgement {
  if (model === "supported") {
    return { action: "flag", reason: `${reason} The second model marked it supported, so it stays for a check.` };
  }
  return { action: "drop", reason };
}

function judgeSentence(
  sentence: WorkingSentence,
  passages: Passage[],
  verdicts: Map<string, ModelVerdict>,
  question: string,
): Judgement {
  const cited = evidenceTexts(sentence.citations, passages);
  const model = verdicts.get(sentence.id)?.verdict;
  if (sentence.kind === "inference") {
    const pool = cited.length > 0 ? cited : passages.map((passage) => passage.text);
    const missingNumber = numberTokens(sentence.text).find((token) => !numberSatisfied(token, pool.join("\n")));
    if (missingNumber) return soften(`Inference introduces ${missingNumber}, which is not in the cited passage.`, model);
    const missingName = properNouns(sentence.text).find((name) => !pool.some((text) => nameInText(name, text)));
    if (missingName) return soften(`Inference introduces ${missingName}, which is not in the cited passage.`, model);
    return { action: "keep", reason: "Labeled inference, with no new figures or names." };
  }
  if (cited.length === 0) {
    return soften(
      sentence.citations.length === 0
        ? "Factual sentence has no citation."
        : "The citation does not match a stored passage.",
      model,
    );
  }
  const support = assessSupport(sentence.text, cited, sourceMetadata(passages));
  const verbatim = appearsVerbatim(sentence.text, cited);
  const localOff = question ? offTopicReason(question, sentence.text) : null;
  const modelOff = verdicts.get(sentence.id)?.relevant === false;
  const onSubject = question
    ? subjectOverlap(question, sentence.text) >= 2 || subjectOverlap(question, cited.join("\n")) >= 2
    : false;
  const offTopic = Boolean(localOff) || (modelOff && !onSubject);
  if (offTopic && (support.level !== "unsupported" || model === "supported" || verbatim)) {
    return { action: "aside", reason: localOff ?? "The sentence does not answer this question's place or subject." };
  }
  const figuresNamed = support.reason.startsWith("The cited passage contains the figures");
  if ((verbatim || figuresNamed) && !offTopic) {
    return { action: "keep", reason: support.reason };
  }
  if (support.level === "unsupported") return soften(support.reason, model);
  if (support.level === "partial") {
    if (model === "unsupported") {
      return { action: "drop", reason: `${support.reason} The second model also rejected it.` };
    }
    return { action: "flag", reason: support.reason };
  }
  if (model === "unsupported") {
    return {
      action: "flag",
      reason: "The passage matches the wording, and the second model dissented. It stays marked for a check.",
    };
  }
  return { action: "keep", reason: support.reason };
}

function toSentence(sentence: WorkingSentence, passages: Passage[], flag?: "partial"): Sentence {
  const next: Sentence = {
    id: sentence.id,
    text: sentence.text,
    kind: sentence.kind,
    citations: familyIds(sentence.citations, passages),
  };
  if (flag) next.flag = flag;
  return next;
}

export function verificationNote(input: {
  mode: "live" | "mock";
  modelUsed: boolean;
  modelError: string | null;
  droppedOverride: boolean;
  language?: string;
}): string {
  const indonesian = /^id\b|indones/i.test(input.language ?? "");
  if (input.mode === "mock") {
    if (indonesian) {
      return input.droppedOverride
        ? "Mode contoh tidak memanggil Nebius. Setiap kalimat dicocokkan dengan kutipannya. Pemeriksa simulasi menandai kalimat yang dicoret sebagai didukung, dan pemeriksaan kutipan mengalahkannya."
        : "Mode contoh tidak memanggil Nebius. Setiap kalimat dicocokkan dengan kutipannya.";
    }
    return input.droppedOverride
      ? "Mock mode did not call Nebius. Local entailment checked every sentence against its passage. A simulated verifier marked a struck sentence as supported; the passage check overrode it."
      : "Mock mode did not call Nebius. Local entailment checked every sentence against its passage.";
  }
  if (input.modelError) {
    return indonesian
      ? `Model kedua tidak selesai (${input.modelError}). Pemeriksaan kutipan tetap dijalankan. Tidak ada kalimat yang terbit tanpa pemeriksaan itu.`
      : `The second model did not finish (${input.modelError}). Local entailment still checked every sentence. Nothing was published without that check.`;
  }
  if (!input.modelUsed) {
    return indonesian
      ? "Setiap kalimat dicocokkan dengan kutipannya."
      : "Local entailment checked every sentence against its passage.";
  }
  return indonesian
    ? "Model kedua di Nebius meninjau kutipan. Kalimat yang dinilai didukung tetap ada, dengan tanda periksa bila pemeriksaan lokal berbeda."
    : "A second Nebius model reviewed the citations. A sentence it marked supported stays, with a check when the local heuristic dissented.";
}

export function adjudicate(input: {
  draft: WorkingBrief;
  passages: Passage[];
  modelVerdicts: ModelVerdict[] | null;
  mode: "live" | "mock";
  modelError: string | null;
  language?: string;
  question?: string;
}): {
  headline: string;
  insufficient: boolean;
  lede: Sentence[];
  sections: { heading: string; sentences: Sentence[] }[];
  conflicts: { topic: string; sides: { label: string; sentences: Sentence[] }[] }[];
  gaps: string[];
  aside: Sentence[];
  summary: VerificationSummary;
} {
  const verdicts = new Map((input.modelVerdicts ?? []).map((verdict) => [verdict.id, verdict]));
  const citationGroups = new Map<string, string[]>();
  const collectCitations = (sentence: WorkingSentence) => {
    const key = claimKey(sentence.text);
    citationGroups.set(key, [...new Set([...(citationGroups.get(key) ?? []), ...sentence.citations])]);
  };
  input.draft.lede.forEach(collectCitations);
  input.draft.sections.forEach((section) => section.sentences.forEach(collectCitations));
  input.draft.conflicts.forEach((conflict) => conflict.sides.forEach((side) => side.sentences.forEach(collectCitations)));
  const aside: Sentence[] = [];
  const asideKeys = new Set<string>();
  const dropped: { text: string; reason: string }[] = [];
  const droppedKeys = new Set<string>();
  let supported = 0;
  let flagged = 0;
  let inferences = 0;
  let checked = 0;
  let droppedOverride = false;

  const keep = (sentence: WorkingSentence): Sentence | null => {
    if (isSiteStat(sentence.text)) return null;
    checked += 1;
    const merged: WorkingSentence = {
      ...sentence,
      citations: citationGroups.get(claimKey(sentence.text)) ?? sentence.citations,
    };
    const judgement = judgeSentence(merged, input.passages, verdicts, input.question ?? "");
    if (judgement.action === "aside") {
      const key = sentence.text.trim().toLowerCase();
      if (!asideKeys.has(key)) {
        asideKeys.add(key);
        aside.push(toSentence(merged, input.passages));
      }
      return null;
    }
    if (judgement.action === "drop") {
      if (verdicts.get(sentence.id)?.verdict === "supported" && sentence.kind === "fact") droppedOverride = true;
      const key = sentence.text.trim().toLowerCase();
      if (!droppedKeys.has(key)) {
        droppedKeys.add(key);
        dropped.push({ text: sentence.text, reason: judgement.reason });
      }
      return null;
    }
    if (sentence.kind === "inference") inferences += 1;
    if (judgement.action === "flag") {
      flagged += 1;
      return toSentence(merged, input.passages, "partial");
    }
    if (sentence.kind === "fact") supported += 1;
    return toSentence(merged, input.passages);
  };

  const lede = input.draft.lede.map(keep).filter((sentence): sentence is Sentence => Boolean(sentence));
  const seenClaims = new Set(lede.map((sentence) => claimKey(sentence.text)));
  const sections = input.draft.sections
    .map((section) => ({
      heading: section.heading,
      sentences: section.sentences.map(keep).filter((sentence): sentence is Sentence => Boolean(sentence)).filter((sentence) => {
        const key = claimKey(sentence.text);
        if (seenClaims.has(key)) return false;
        seenClaims.add(key);
        return true;
      }),
    }))
    .filter((section) => section.sentences.length > 0);

  const conflicts: { topic: string; sides: { label: string; sentences: Sentence[] }[] }[] = [];
  const gaps = [...input.draft.gaps];
  for (const conflict of input.draft.conflicts) {
    const sides = conflict.sides
      .map((side) => ({
        label: side.label,
        sentences: side.sentences.map(keep).filter((sentence): sentence is Sentence => Boolean(sentence)),
      }))
      .filter((side) => side.sentences.length > 0);
    if (sides.length >= 2) {
      conflicts.push({ topic: conflict.topic, sides });
    } else if (sides.length === 1) {
      const seen = new Set(
        [...lede, ...sections.flatMap((section) => section.sentences)].map((sentence) => sentence.text.trim().toLowerCase()),
      );
      const fresh = sides[0].sentences.filter((sentence) => {
        const key = sentence.text.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (fresh.length > 0) {
        const language = input.language ?? "en";
        sections.push({ heading: loneAccountHeading(language), sentences: fresh });
        gaps.push(language.toLowerCase().startsWith("id") || language.toLowerCase().includes("indones")
          ? `Satu versi tentang "${conflict.topic}" dicoret karena kutipannya tidak menopang kalimat itu.`
          : `A second account of "${conflict.topic}" was struck because the cited text did not support it.`);
      }
    }
  }

  const known = new Set(input.passages.map((passage) => passage.id));
  const strip = (sentence: Sentence): Sentence => ({
    ...sentence,
    citations: sentence.citations.filter((id) => known.has(id)),
  });
  const ledeOut = dropThinnerRestatements(lede.map(strip));
  const sectionsOut = sections.map((section) => ({
    ...section,
    sentences: dropThinnerRestatements(section.sentences.map(strip)).filter(
      (sentence) => !ledeOut.some((kept) => isThinnerRestatement(sentence.text, kept.text)),
    ),
  }));
  let conflictsOut = conflicts.map((conflict) => ({
    ...conflict,
    sides: conflict.sides.map((side) => ({ ...side, sentences: side.sentences.map(strip) })),
  }));

  const sourced = withinSourceConflicts(input.passages, input.language ?? "en");
  for (const conflict of sourced) {
    if (!conflictsOut.some((existing) => existing.sides.length >= 2 && existing.topic === conflict.topic)) {
      conflictsOut.push(conflict);
    }
  }
  const bodyText = [
    ...ledeOut,
    ...sectionsOut.flatMap((section) => section.sentences),
  ].map((sentence) => sentence.text);
  conflictsOut = conflictsOut.map((conflict) => ({
    ...conflict,
    sides: conflict.sides.map((side) => ({
      ...side,
      sentences: side.sentences.map((sentence) => ({ ...sentence, text: concisePosition(sentence.text, bodyText) })),
    })),
  }));

  const keptSentences = [
    ...ledeOut,
    ...sectionsOut.flatMap((section) => section.sentences),
    ...conflictsOut.flatMap((conflict) => conflict.sides.flatMap((side) => side.sentences)),
  ];
  let insufficient = input.draft.insufficient;
  let headline = softenConflictHeadline(input.draft.headline, input.language ?? "en", conflictsOut.some((conflict) => conflict.sides.length >= 2));
  if (keptSentences.length === 0) {
    insufficient = true;
    gaps.splice(0, gaps.length, ...gaps.filter((gap) => !/passage check|factual sentence remained/i.test(gap)));
    if (input.passages.length > 0) {
      const indonesian = /^id\b|indones/i.test(input.language ?? "");
      const removed = [...dropped.map((item) => item.text), ...aside.map((item) => item.text)];
      if (headlineFollowsRemoved(headline, removed) || headline.trim().length < 8) {
        headline = gapHeadline(input.question ?? "", input.language ?? "en");
      }
      const nearest = nearestFinding(input.question ?? "", input.passages, input.language ?? "en");
      if (nearest) ledeOut.push(nearest);
      const gap = indonesian
        ? "Halaman yang tersimpan tidak memuat jawaban untuk pertanyaan ini."
        : "The stored pages do not contain an answer to this question.";
      if (!gaps.some((item) => /tidak memuat jawaban|do not contain an answer/i.test(item))) gaps.push(gap);
    }
  }

  const modelUsed = input.modelVerdicts !== null && input.modelError === null && input.mode === "live";
  return {
    headline,
    insufficient,
    lede: ledeOut,
    sections: sectionsOut,
    conflicts: conflictsOut,
    gaps: uniqueGaps(gaps),
    aside,
    summary: {
      checked,
      supported,
      flagged,
      dropped: dropped.length,
      inferences,
      droppedSentences: dropped,
      verifier: modelUsed ? "model+local" : "local",
      note: verificationNote({
        mode: input.mode,
        modelUsed,
        modelError: input.modelError,
        droppedOverride,
        language: input.language,
      }),
    },
  };
}

const CONFLICT_HEADLINE = /bertentangan|tidak sepakat|kontradik|disagree|conflict/i;

function softenConflictHeadline(headline: string, language: string, hasTwoSidedConflict: boolean): string {
  if (hasTwoSidedConflict || !CONFLICT_HEADLINE.test(headline)) return headline;
  return /^id\b|indones/i.test(language)
    ? "Sumber yang ada tidak menetapkan satu jawaban"
    : "The stored pages do not settle one answer";
}

function headlineFollowsRemoved(headline: string, removed: string[]): boolean {
  const numbers = new Set(removed.flatMap((text) => numberTokens(text)));
  if (numberTokens(headline).some((token) => numbers.has(token))) return true;
  return removed.some((text) => similarWording(headline, text));
}

function similarWording(left: string, right: string): boolean {
  const a = new Set(contentWords(left));
  const b = new Set(contentWords(right));
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size) >= 0.6;
}

function gapHeadline(question: string, language: string): string {
  const q = question.replace(/\s+/g, " ").trim().replace(/[?？]+$/g, "");
  const indonesian = /^id\b|indones/i.test(language);
  if (!q) return indonesian ? "Sumber yang ada tidak menjawab ini" : "The searched pages do not answer this";
  if (indonesian && /^berapa\b/i.test(q)) return `Tidak ada sumber yang menyebut ${q.replace(/^berapa\s+/i, "")}`;
  if (indonesian && /^apakah\b/i.test(q)) return `Sumber yang ada tidak menetapkan apakah ${q.replace(/^apakah\s+/i, "")}`;
  if (indonesian) return `Sumber yang ada tidak menjawab ${q.charAt(0).toLowerCase()}${q.slice(1)}`;
  if (/^how many\b/i.test(q)) return `No stored source states how many ${q.replace(/^how many\s+/i, "")}`;
  return `The stored pages do not answer ${q.charAt(0).toLowerCase()}${q.slice(1)}`;
}

function nearestFinding(question: string, passages: Passage[], language: string): Sentence | null {
  if (passages.length === 0) return null;
  const wanted = new Set(question ? contentWords(question) : []);
  let best = passages[0]!;
  let bestScore = -1;
  for (const passage of passages) {
    const score = contentWords(`${passage.title} ${passage.text}`).filter((word) => wanted.has(word)).length;
    if (score > bestScore) {
      best = passage;
      bestScore = score;
    }
  }
  const indonesian = /^id\b|indones/i.test(language);
  const name = best.publisher.trim() || (indonesian ? "sumber tersimpan" : "the stored page");
  const title = best.title.trim();
  const usableTitle = title && title.length <= 48 && !/[…\u2026]|\.{3}/.test(title) && !/^(pengaruh|the effect|the impact)\b/i.test(title);
  const text = indonesian
    ? (usableTitle ? `Yang paling dekat adalah tulisan ${name} berjudul ${title}.` : `Yang paling dekat berasal dari ${name}.`)
    : (usableTitle ? `The nearest page is from ${name}, titled ${title}.` : `The nearest page is from ${name}.`);
  return { id: `near-${best.id}`, text, kind: "fact", citations: [best.id], flag: "partial" };
}

function figureValues(text: string): number[] {
  return numberTokens(text).map((token) => Number(token.replace("%", ""))).filter((value) => Number.isFinite(value));
}

function isThinnerRestatement(thinner: string, fuller: string): boolean {
  const small = figureValues(thinner);
  const full = figureValues(fuller);
  if (small.length === 0 || small.length > 2 || full.length < 2) return false;
  if (properNouns(thinner).some((name) => !nameInText(name, fuller))) return false;
  const diffs: number[] = [];
  for (let i = 0; i < full.length; i += 1) {
    for (let j = i + 1; j < full.length; j += 1) diffs.push(Math.abs(full[i]! - full[j]!));
  }
  const explained = small.every((value) => diffs.some((diff) => Math.abs(diff - value) < 0.051) || full.some((item) => Math.abs(item - value) < 0.051));
  const derived = small.some((value) => diffs.some((diff) => Math.abs(diff - value) < 0.051));
  return explained && derived;
}

function dropThinnerRestatements(sentences: Sentence[]): Sentence[] {
  const drop = new Set<string>();
  for (let i = 0; i < sentences.length; i += 1) {
    for (let j = i + 1; j < sentences.length; j += 1) {
      const left = sentences[i]!;
      const right = sentences[j]!;
      if (isThinnerRestatement(left.text, right.text)) drop.add(left.id);
      if (isThinnerRestatement(right.text, left.text)) drop.add(right.id);
    }
  }
  return sentences.filter((sentence) => !drop.has(sentence.id));
}

function concisePosition(text: string, body: string[]): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ");
  const repeats = body.some((item) => similarWording(cleaned, item) || claimKey(cleaned) === claimKey(item));
  if (words.length <= 18 && !repeats) return cleaned;
  if (words.length <= 12) return cleaned;
  const pieces = cleaned.split(/,\s+(?:and|but|while|whereas|dan|tetapi|namun|sedangkan)\s+/i);
  let chosen = (pieces[pieces.length - 1] ?? cleaned).replace(/^(?:that|the claim that)\s+/i, "");
  let chosenWords = chosen.split(/\s+/);
  if (chosenWords.length < 6 || chosenWords.length > 18) {
    chosen = words.slice(-16).join(" ");
    chosenWords = chosen.split(/\s+/);
  }
  chosen = `${chosen.charAt(0).toUpperCase()}${chosen.slice(1)}`;
  return /[.!?]$/.test(chosen) ? chosen : `${chosen.replace(/[,:;]$/, "")}.`;
}

const HIGHER_RISK = /\b(meningkat(?:kan)?|menaik(?:kan)?|increase[sd]?|higher|raises|raising)\b/i;
const LOWER_RISK = /\b(menurun(?:kan)?|lower|decreas\w*|tidak meningkat(?:kan)?|tidak menaik(?:kan)?)\b/i;

function withinSourceConflicts(passages: Passage[], language: string): { topic: string; sides: { label: string; sentences: Sentence[] }[] }[] {
  const byUrl = new Map<string, Passage[]>();
  for (const passage of passages) {
    const key = canonicalUrl(passage.url);
    byUrl.set(key, [...(byUrl.get(key) ?? []), passage]);
  }
  const indonesian = /^id\b|indones/i.test(language);
  const conflicts: { topic: string; sides: { label: string; sentences: Sentence[] }[] }[] = [];
  for (const group of byUrl.values()) {
    if (group.length < 2) continue;
    const higher = group.find((passage) => HIGHER_RISK.test(passage.text));
    const lower = group.find((passage) => LOWER_RISK.test(passage.text) && passage.id !== higher?.id);
    if (!higher || !lower) continue;
    const shared = numberTokens(higher.text).some((token) => numberTokens(lower.text).includes(token));
    if (!shared) continue;
    const dose = (passage: Passage) => {
      const match = passage.text.match(/(?:lebih\s+dari|more\s+than|at\s+least|>|≥|≤|<=|<)\s*\d+\s*(?:cangkir|cups)?/i);
      return match ? match[0].replace(/\s+/g, " ").trim() : "";
    };
    const sideText = (passage: Passage, higherRisk: boolean) => {
      const hint = dose(passage);
      if (indonesian) {
        return higherRisk
          ? `Kutipan ini mengaitkan${hint ? ` ${hint}` : ""} dengan risiko yang lebih tinggi.`
          : `Kutipan ini mengaitkan${hint ? ` ${hint}` : ""} dengan risiko yang lebih rendah.`;
      }
      return higherRisk
        ? `This passage links${hint ? ` ${hint}` : " intake"} with higher risk.`
        : `This passage links${hint ? ` ${hint}` : " intake"} with lower risk.`;
    };
    conflicts.push({
      topic: indonesian ? "Temuan yang berlawanan di sumber yang sama" : "The same source disagrees with itself",
      sides: [
        {
          label: indonesian ? "Risiko naik" : "Higher risk",
          sentences: [{ id: `up-${higher.id}`, text: sideText(higher, true), kind: "fact", citations: [higher.id] }],
        },
        {
          label: indonesian ? "Risiko turun" : "Lower risk",
          sentences: [{ id: `down-${lower.id}`, text: sideText(lower, false), kind: "fact", citations: [lower.id] }],
        },
      ],
    });
  }
  return conflicts;
}
