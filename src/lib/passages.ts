import type { SelectedHit } from "@/lib/sources";
import { canonicalUrl, clip, contentWords, publisherFromUrl, readablePublisher } from "@/lib/text";
import type { ExtractResult, Passage } from "@/lib/types";

export type ReadNote = {
  url: string;
  title: string;
  status: "extracted" | "snippet" | "failed";
  detail: string;
};

function overlapScore(chunk: string, query: string): number {
  const wanted = new Set(contentWords(query));
  if (wanted.size === 0) return chunk.length;
  return contentWords(chunk).filter((word) => wanted.has(word)).length;
}

const BOILERPLATE = [
  /subscribe to continue/i,
  /subscribe now to read/i,
  /already a subscriber/i,
  /sign in to continue/i,
  /to continue reading/i,
  /this (?:article|content) is (?:for|available to) subscribers/i,
  /create an account to (?:read|continue)/i,
  /enable javascript and cookies/i,
  /accept all cookies/i,
  /we use cookies/i,
  /cookie settings/i,
  /privacy preference/i,
];

export function isBoilerplate(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 40) return false;
  const hits = BOILERPLATE.filter((pattern) => pattern.test(trimmed)).length;
  if (hits >= 2) return true;
  if (hits >= 1 && contentWords(trimmed).length < 80) return true;
  const pipes = trimmed.match(/\|/g)?.length ?? 0;
  return pipes >= 8 && trimmed.length < 500;
}

export function flattenMarkdownTables(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let table: string[] = [];
  const flush = () => {
    if (table.length === 0) return;
    out.push(table.join("\n"));
    table = [];
  };
  for (const line of lines) {
    const rendered = renderTableLine(line);
    if (rendered === undefined) {
      flush();
      out.push(line);
    } else if (rendered) {
      table.push(rendered);
    }
  }
  flush();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function renderTableLine(line: string): string | null | undefined {
  const pipes = line.match(/\|/g)?.length ?? 0;
  if (pipes < 2) return undefined;
  const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
  if (cells.length < 2) return undefined;
  if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) return null;
  if (cells.length === 2) return `${cells[0]}: ${cells[1]}`;
  return cells.join(" — ");
}

export function passagesFromDocument(raw: string, query: string): string[] {
  const text = flattenMarkdownTables(raw).trim();
  if (text.length < 40) return [];
  const parts = text
    .split(/\n{2,}|\[\s*\.\.\.\s*\]/g)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 40 && !isBoilerplate(part));
  const whole = text.replace(/\s+/g, " ").trim();
  const chunks = parts.length > 0 ? parts : (!isBoilerplate(whole) && whole.length >= 40 ? [whole] : []);
  if (chunks.length === 0) return [];
  const scored = chunks.map((chunk, index) => ({
    chunk: clip(chunk, 900),
    index,
    score: overlapScore(chunk, query),
  }));
  return [...scored]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.chunk);
}

export function buildPassages(input: {
  kept: SelectedHit[];
  extracted: ExtractResult | null;
  query: string;
}): { passages: Passage[]; notes: ReadNote[] } {
  const passages: Passage[] = [];
  const notes: ReadNote[] = [];
  const documents = new Map(
    (input.extracted?.documents ?? []).map((document) => [canonicalUrl(document.url), document]),
  );
  const failures = new Map(
    (input.extracted?.failed ?? []).map((failure) => [canonicalUrl(failure.url), failure]),
  );

  for (const hit of input.kept) {
    if (passages.length >= 10) {
      notes.push({ url: hit.url, title: hit.title, status: "failed", detail: "Passage cap reached." });
      continue;
    }
    const url = canonicalUrl(hit.url);
    const document = documents.get(url);
    const chunks = document ? passagesFromDocument(document.rawContent, input.query) : [];
    if (chunks.length > 0) {
      for (const text of chunks) {
        if (passages.length >= 10) break;
        passages.push(makePassage(passages.length + 1, hit, text, "extract"));
      }
      notes.push({
        url: hit.url,
        title: hit.title,
        status: "extracted",
        detail: `Extracted ${Math.min(chunks.length, 2)} passage${chunks.length === 1 ? "" : "s"}.`,
      });
      continue;
    }
    const snippet = flattenMarkdownTables(hit.content).trim();
    if (isBoilerplate(snippet) || (document && isBoilerplate(document.rawContent) && isBoilerplate(snippet))) {
      notes.push({
        url: hit.url,
        title: hit.title,
        status: "failed",
        detail: "Discarded paywall or site boilerplate.",
      });
      continue;
    }
    if (snippet.length >= 40 && !isBoilerplate(snippet) && passages.length < 10) {
      passages.push(makePassage(passages.length + 1, hit, clip(snippet, 900), "snippet"));
      const failure = failures.get(url);
      notes.push({
        url: hit.url,
        title: hit.title,
        status: "snippet",
        detail: failure
          ? `Extract failed (${failure.error}). Search snippet kept.`
          : "Extract returned no passage. Search snippet kept.",
      });
      continue;
    }
    notes.push({
      url: hit.url,
      title: hit.title,
      status: "failed",
      detail: failures.get(url)?.error ?? "No usable passage.",
    });
  }

  return { passages, notes };
}

function makePassage(index: number, hit: SelectedHit, text: string, origin: Passage["origin"]): Passage {
  return {
    id: `p${index}`,
    url: hit.url,
    title: hit.title,
    publisher: readablePublisher(hit.publisher || publisherFromUrl(hit.url), hit.title, hit.url),
    publishedDate: hit.publishedDate,
    text,
    origin,
  };
}
