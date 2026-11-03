import { canonicalUrl, publisherFromUrl, readablePublisher } from "@/lib/text";
import type { SearchHit } from "@/lib/types";

export type SelectedHit = SearchHit & {
  subquestionId: string;
  decision: "kept" | "discarded";
  reason: string;
};

export function isUsableHit(hit: SearchHit): boolean {
  return hit.score >= 0.35 && hit.content.trim().length >= 40;
}

export function isWeak(hits: SearchHit[]): boolean {
  return !hits.some(isUsableHit);
}

export function selectSources(
  groups: { subquestionId: string; hits: SearchHit[] }[],
  maxUrls: number,
): { kept: SelectedHit[]; discarded: SelectedHit[] } {
  const discarded: SelectedHit[] = [];
  const bestByUrl = new Map<string, SelectedHit>();

  for (const group of groups) {
    for (const hit of group.hits) {
      const url = canonicalUrl(hit.url);
      const row: SelectedHit = {
        ...hit,
        url,
        publisher: readablePublisher(hit.publisher || publisherFromUrl(hit.url), hit.title, hit.url),
        subquestionId: group.subquestionId,
        decision: "kept",
        reason: "Selected to read",
      };
      const previous = bestByUrl.get(url);
      if (!previous || hit.score > previous.score) {
        if (previous) discarded.push({ ...previous, decision: "discarded", reason: "Duplicate URL" });
        bestByUrl.set(url, row);
      } else {
        discarded.push({ ...row, decision: "discarded", reason: "Duplicate URL" });
      }
    }
  }

  const eligible: SelectedHit[] = [];
  for (const hit of bestByUrl.values()) {
    if (!isUsableHit(hit)) {
      discarded.push({ ...hit, decision: "discarded", reason: "Weak match" });
    } else {
      eligible.push(hit);
    }
  }

  const pool = eligible.sort((a, b) => b.score - a.score);
  const kept: SelectedHit[] = [];
  const usedGroups = new Set<string>();
  for (const hit of pool) {
    if (kept.length >= maxUrls) break;
    if (usedGroups.has(hit.subquestionId)) continue;
    kept.push(hit);
    usedGroups.add(hit.subquestionId);
  }
  for (const hit of pool) {
    if (kept.length >= maxUrls) break;
    if (kept.includes(hit)) continue;
    kept.push(hit);
  }
  for (const hit of pool) {
    if (!kept.includes(hit)) {
      discarded.push({ ...hit, decision: "discarded", reason: "Held back to stay inside the extract budget" });
    }
  }
  return { kept, discarded };
}
