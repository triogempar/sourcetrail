import type { SelectedHit } from "@/lib/sources";
import { canonicalUrl, clip, contentWords, publisherFromUrl } from "@/lib/text";
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

export function passagesFromDocument(raw: string, query: string): string[] {
  const text = raw.replace(/\r/g, "").trim();
  if (text.length < 40) return [];
  const parts = text
    .split(/\n{2,}|\[\s*\.\.\.\s*\]/g)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 40);
  const chunks = parts.length > 0 ? parts : [text.replace(/\s+/g, " ").trim()];
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
    const snippet = hit.content.trim();
    if (snippet.length >= 40 && passages.length < 10) {
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
    publisher: hit.publisher || publisherFromUrl(hit.url),
    publishedDate: hit.publishedDate,
    text,
    origin,
  };
}
