import { assessSupport } from "@/lib/entailment";
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
  const localOff = question ? offTopicReason(question, sentence.text) : null;
  const modelOff = verdicts.get(sentence.id)?.relevant === false;
  const onSubject = question
    ? subjectOverlap(question, sentence.text) >= 2 || subjectOverlap(question, cited.join("\n")) >= 2
    : false;
  const offTopic = Boolean(localOff) || (modelOff && !onSubject);
  if (offTopic && (support.level !== "unsupported" || model === "supported")) {
    return { action: "aside", reason: localOff ?? "The sentence does not answer this question's place or subject." };
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
}): string {
  if (input.mode === "mock") {
    return input.droppedOverride
      ? "Mock mode did not call Nebius. Local entailment checked every sentence against its passage. A simulated verifier marked a struck sentence as supported; the passage check overrode it."
      : "Mock mode did not call Nebius. Local entailment checked every sentence against its passage.";
  }
  if (input.modelError) {
    return `The second model did not finish (${input.modelError}). Local entailment still checked every sentence. Nothing was published without that check.`;
  }
  if (!input.modelUsed) {
    return "Local entailment checked every sentence against its passage.";
  }
  return "A second Nebius model reviewed the citations. A sentence it marked supported stays, with a check when the local heuristic dissented.";
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
  const ledeOut = lede.map(strip);
  const sectionsOut = sections.map((section) => ({ ...section, sentences: section.sentences.map(strip) }));
  const conflictsOut = conflicts.map((conflict) => ({
    ...conflict,
    sides: conflict.sides.map((side) => ({ ...side, sentences: side.sentences.map(strip) })),
  }));

  const sourced = withinSourceConflicts(input.passages, input.language ?? "en");
  for (const conflict of sourced) {
    if (!conflictsOut.some((existing) => existing.sides.length >= 2 && existing.topic === conflict.topic)) {
      conflictsOut.push(conflict);
    }
  }

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
      headline = indonesian ? "Sumber yang ada tidak menjawab ini" : "The searched pages do not answer this";
      const nearest = nearestFinding(input.question ?? "", input.passages, input.language ?? "en");
      if (nearest) ledeOut.push(nearest);
      const gap = indonesian
        ? "Sumber yang tersimpan tidak mencakup jawaban langsung. Kalimat di atas hanya menunjuk halaman terdekat."
        : "The stored pages do not directly answer the question. The sentence above only points to the nearest page.";
      if (!gaps.some((item) => /halaman terdekat|nearest page/i.test(item))) gaps.push(gap);
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
  const name = best.publisher.trim() || (indonesian ? "Sumber" : "The stored page");
  const about = clip(best.title.trim() || (indonesian ? "halaman tersimpan" : "a stored page"), 72);
  const text = indonesian
    ? `${name} membahas “${about}”, dan halaman itu tidak menjawab pertanyaan secara langsung.`
    : `${name} discusses “${about},” and that page does not directly answer the question.`;
  return { id: `near-${best.id}`, text, kind: "fact", citations: [best.id], flag: "partial" };
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
