import { assessSupport } from "@/lib/entailment";
import type { ModelVerdict } from "@/lib/schema";
import { cleanSentence, clip, hasWord, numberTokens, properNouns } from "@/lib/text";
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
      text: cleanSentence(sentence.text),
      kind: sentence.kind,
      citations: dedupe(sentence.citations),
    };
  };
  return {
    headline: clip(cleanSentence(draft.headline), 180) || "Research brief",
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
    gaps: dedupe(draft.gaps.map((gap) => clip(cleanSentence(gap), 320)).filter(Boolean)).slice(0, 8),
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
  action: "keep" | "flag" | "drop";
  reason: string;
};

function judgeSentence(
  sentence: WorkingSentence,
  passages: Passage[],
  verdicts: Map<string, ModelVerdict>,
): Judgement {
  const cited = sentence.citations
    .map((id) => passages.find((passage) => passage.id === id)?.text)
    .filter((text): text is string => Boolean(text));
  const model = verdicts.get(sentence.id)?.verdict;
  if (sentence.kind === "inference") {
    const pool = cited.length > 0 ? cited : passages.map((passage) => passage.text);
    const missingNumber = numberTokens(sentence.text).find((token) => !pool.some((text) => numberTokens(text).includes(token)));
    if (missingNumber) {
      return { action: "drop", reason: `Inference introduces ${missingNumber}, which is not in the cited passage.` };
    }
    const missingName = properNouns(sentence.text).find((name) => !pool.some((text) => hasWord(text, name)));
    if (missingName) {
      return { action: "drop", reason: `Inference introduces ${missingName}, which is not in the cited passage.` };
    }
    return { action: "keep", reason: "Labeled inference, with no new figures or names." };
  }
  if (cited.length === 0) {
    return {
      action: "drop",
      reason: sentence.citations.length === 0
        ? "Factual sentence has no citation."
        : "The citation does not match a stored passage.",
    };
  }
  const support = assessSupport(sentence.text, cited);
  if (support.level === "unsupported") {
    const override = model === "supported" ? " A model marked it supported; the passage check struck it." : "";
    return { action: "drop", reason: `${support.reason}${override}` };
  }
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

function toSentence(sentence: WorkingSentence, flag?: "partial"): Sentence {
  const next: Sentence = {
    id: sentence.id,
    text: sentence.text,
    kind: sentence.kind,
    citations: sentence.citations,
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
  return input.droppedOverride
    ? "A second Nebius model reviewed the citations. Where it approved a sentence the passage does not contain, the passage check won."
    : "A second Nebius model reviewed the citations, and each surviving fact still matches its passage.";
}

export function adjudicate(input: {
  draft: WorkingBrief;
  passages: Passage[];
  modelVerdicts: ModelVerdict[] | null;
  mode: "live" | "mock";
  modelError: string | null;
}): {
  headline: string;
  insufficient: boolean;
  lede: Sentence[];
  sections: { heading: string; sentences: Sentence[] }[];
  conflicts: { topic: string; sides: { label: string; sentences: Sentence[] }[] }[];
  gaps: string[];
  summary: VerificationSummary;
} {
  const verdicts = new Map((input.modelVerdicts ?? []).map((verdict) => [verdict.id, verdict]));
  const dropped: { text: string; reason: string }[] = [];
  let supported = 0;
  let flagged = 0;
  let inferences = 0;
  let checked = 0;
  let droppedOverride = false;

  const keep = (sentence: WorkingSentence): Sentence | null => {
    checked += 1;
    const judgement = judgeSentence(sentence, input.passages, verdicts);
    if (judgement.action === "drop") {
      if (verdicts.get(sentence.id)?.verdict === "supported" && sentence.kind === "fact") droppedOverride = true;
      dropped.push({ text: sentence.text, reason: judgement.reason });
      return null;
    }
    if (sentence.kind === "inference") inferences += 1;
    if (judgement.action === "flag") {
      flagged += 1;
      return toSentence(sentence, "partial");
    }
    if (sentence.kind === "fact") supported += 1;
    return toSentence(sentence);
  };

  const lede = input.draft.lede.map(keep).filter((sentence): sentence is Sentence => Boolean(sentence));
  const sections = input.draft.sections
    .map((section) => ({
      heading: section.heading,
      sentences: section.sentences.map(keep).filter((sentence): sentence is Sentence => Boolean(sentence)),
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
      sections.push({ heading: "Reported without a second account", sentences: sides[0].sentences });
      gaps.push(`A second account of "${conflict.topic}" was struck because the passage did not support it.`);
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

  const factCount = [...ledeOut, ...sectionsOut.flatMap((section) => section.sentences), ...conflictsOut.flatMap((conflict) => conflict.sides.flatMap((side) => side.sentences))]
    .filter((sentence) => sentence.kind === "fact").length;
  let insufficient = input.draft.insufficient;
  if (factCount === 0) {
    insufficient = true;
    if (!gaps.some((gap) => gap.includes("passage check"))) {
      gaps.push("No factual sentence remained after the passage check.");
    }
  }

  const modelUsed = input.modelVerdicts !== null && input.modelError === null && input.mode === "live";
  return {
    headline: input.draft.headline,
    insufficient,
    lede: ledeOut,
    sections: sectionsOut,
    conflicts: conflictsOut,
    gaps: dedupe(gaps).slice(0, 8),
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
