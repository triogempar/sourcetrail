import { SchemaError } from "@/lib/errors";
import { closeTruncatedJson, extractJson } from "@/lib/json";
import { cleanHeadline, cleanSentence, clip, uniqueGaps } from "@/lib/text";
import type { DraftBrief, DraftSentence, Plan, TimeRange } from "@/lib/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTimeRange(value: unknown): TimeRange | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  const map: Record<string, TimeRange> = {
    day: "day",
    d: "day",
    week: "week",
    w: "week",
    month: "month",
    m: "month",
    year: "year",
    y: "year",
  };
  return map[normalized] ?? null;
}

export function parsePlan(data: unknown): Plan {
  if (!isRecord(data)) throw new SchemaError("Plan was not a JSON object.");
  const recency = data.recency === true;
  const timeRange = asTimeRange(data.timeRange) ?? (recency ? "month" : null);
  const topic = recency || data.topic === "news" ? "news" : "general";
  const language = typeof data.language === "string" && data.language.trim()
    ? clip(data.language, 40)
    : "the language of the question";
  if (!Array.isArray(data.subquestions)) throw new SchemaError("Plan is missing subquestions.");
  const subquestions = data.subquestions.slice(0, 5).map((item, index) => {
    if (!isRecord(item)) throw new SchemaError(`Sub-question ${index + 1} was not an object.`);
    const question = typeof item.question === "string" ? cleanSentence(item.question) : "";
    const query = typeof item.query === "string" ? item.query.replace(/\s+/g, " ").trim() : "";
    if (question.length < 8) throw new SchemaError(`Sub-question ${index + 1} is too short.`);
    if (query.length < 3) throw new SchemaError(`Sub-question ${index + 1} is missing a query.`);
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 24) : `sq${index + 1}`;
    const needsRecency = typeof item.needsRecency === "boolean" ? item.needsRecency : recency;
    return { id, question: clip(question, 240), query: clip(query, 180), needsRecency };
  });
  const ids = new Set<string>();
  for (const [index, subquestion] of subquestions.entries()) {
    if (ids.has(subquestion.id)) subquestion.id = `sq${index + 1}`;
    ids.add(subquestion.id);
  }
  if (subquestions.length < 3) {
    throw new SchemaError(`Plan has ${subquestions.length} sub-questions; expected 3 to 5.`);
  }
  return { language, recency, timeRange: recency ? timeRange ?? "month" : timeRange, topic, subquestions };
}

export function parseRewrite(data: unknown): { query: string } {
  if (!isRecord(data) || typeof data.query !== "string") {
    throw new SchemaError("Rewrite is missing a query string.");
  }
  const query = data.query.replace(/\s+/g, " ").trim();
  if (query.length < 3) throw new SchemaError("Rewritten query is too short.");
  return { query: clip(query, 180) };
}

function parseCitation(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/p\d+/i);
  return match ? match[0].toLowerCase() : null;
}

function parseSentence(value: unknown, label: string): DraftSentence {
  if (!isRecord(value)) throw new SchemaError(`${label} was not an object.`);
  const text = typeof value.text === "string" ? cleanSentence(value.text) : "";
  if (text.length < 8) throw new SchemaError(`${label} is too short.`);
  const kindRaw = typeof value.kind === "string" ? value.kind.toLowerCase() : "";
  if (kindRaw !== "fact" && kindRaw !== "inference") {
    throw new SchemaError(`${label} must be kind fact or inference.`);
  }
  const citations = Array.isArray(value.citations)
    ? [...new Set(value.citations.map(parseCitation).filter((id): id is string => Boolean(id)))]
    : [];
  return { text: clip(text, 500), kind: kindRaw, citations };
}

function parseSentenceList(value: unknown, label: string): DraftSentence[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new SchemaError(`${label} was not an array.`);
  return value.map((item, index) => parseSentence(item, `${label} ${index + 1}`));
}

export function parseDraft(data: unknown): DraftBrief {
  if (!isRecord(data)) throw new SchemaError("Brief was not a JSON object.");
  const headline = typeof data.headline === "string" ? cleanHeadline(data.headline) : "";
  if (headline.length < 8) throw new SchemaError("Brief headline is missing.");
  const ledeSource = Array.isArray(data.lede) ? data.lede : data.answer;
  const lede = parseSentenceList(ledeSource, "Lede sentence");
  const sections = Array.isArray(data.sections)
    ? data.sections.map((section, index) => {
        if (!isRecord(section)) throw new SchemaError(`Section ${index + 1} was not an object.`);
        const heading = typeof section.heading === "string" ? cleanSentence(section.heading) : "";
        return {
          heading: clip(heading || "Notes", 120),
          sentences: parseSentenceList(section.sentences, `Section ${index + 1} sentence`),
        };
      })
    : [];
  const conflicts = Array.isArray(data.conflicts)
    ? data.conflicts.map((conflict, index) => {
        if (!isRecord(conflict)) throw new SchemaError(`Conflict ${index + 1} was not an object.`);
        const topic = typeof conflict.topic === "string" ? cleanSentence(conflict.topic) : "";
        const sides = Array.isArray(conflict.sides)
          ? conflict.sides.map((side, sideIndex) => {
              if (!isRecord(side)) throw new SchemaError(`Conflict ${index + 1} side ${sideIndex + 1} was not an object.`);
              const label = typeof side.label === "string" ? cleanSentence(side.label) : "";
              return {
                label: clip(label || "Account", 80),
                sentences: parseSentenceList(side.sentences, `Conflict ${index + 1} side ${sideIndex + 1} sentence`),
              };
            })
          : [];
        return { topic: clip(topic || "Disagreement", 160), sides: sides.filter((side) => side.sentences.length > 0) };
      }).filter((conflict) => conflict.sides.length >= 2)
    : [];
  const gaps = uniqueGaps(
    Array.isArray(data.gaps)
      ? data.gaps
          .filter((gap): gap is string => typeof gap === "string")
          .map((gap) => clip(cleanSentence(gap), 320))
      : [],
  );
  const insufficient = data.insufficient === true;
  const total = lede.length
    + sections.reduce((sum, section) => sum + section.sentences.length, 0)
    + conflicts.reduce((sum, conflict) => sum + conflict.sides.reduce((sideSum, side) => sideSum + side.sentences.length, 0), 0);
  if (total === 0 && !insufficient && gaps.length === 0) {
    throw new SchemaError("Brief has no sentences and does not mark insufficient evidence.");
  }
  if (total > 30) throw new SchemaError("Brief has too many sentences.");
  return { headline: clip(headline, 180), insufficient, lede, sections, conflicts, gaps };
}

export type ModelVerdict = {
  id: string;
  verdict: "supported" | "unsupported" | "partial";
  reason: string;
};

export function parseVerdicts(data: unknown): ModelVerdict[] {
  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.sentences)
      ? data.sentences
      : null;
  if (!list) throw new SchemaError("Verdicts are missing a sentences array.");
  const verdicts: ModelVerdict[] = [];
  for (const row of list) {
    if (!isRecord(row) || typeof row.id !== "string") continue;
    const id = row.id.trim();
    const verdict = row.verdict;
    if (!/^s\d+$/.test(id)) continue;
    if (verdict !== "supported" && verdict !== "unsupported" && verdict !== "partial") continue;
    verdicts.push({
      id,
      verdict,
      reason: typeof row.reason === "string" ? clip(row.reason, 240) : "",
    });
  }
  if (verdicts.length === 0) throw new SchemaError("Verdicts contained no usable sentence ids.");
  return verdicts;
}

/** Pull finished verdict objects out of a token-truncated reply. */
export function salvageVerdicts(text: string): ModelVerdict[] {
  const found = new Map<string, ModelVerdict>();
  const patterns = [
    /"id"\s*:\s*"(s\d+)"[\s\S]{0,240}?"verdict"\s*:\s*"(supported|unsupported|partial)"[\s\S]{0,200}?\}/g,
    /"verdict"\s*:\s*"(supported|unsupported|partial)"[\s\S]{0,240}?"id"\s*:\s*"(s\d+)"[\s\S]{0,80}?\}/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const idFirst = match[1]?.startsWith("s");
      const id = idFirst ? match[1] : match[2];
      const verdict = idFirst ? match[2] : match[1];
      if (!id || (verdict !== "supported" && verdict !== "unsupported" && verdict !== "partial")) continue;
      if (!found.has(id)) found.set(id, { id, verdict, reason: "" });
    }
  }
  return [...found.values()];
}

export function salvageDraft(text: string): DraftBrief | null {
  const closed = closeTruncatedJson(text);
  if (!closed) return null;
  try {
    return parseDraft(closed);
  } catch {
    return null;
  }
}

export function readVerdicts(text: string): ModelVerdict[] {
  try {
    return parseVerdicts(extractJson(text));
  } catch {
    return salvageVerdicts(text);
  }
}
