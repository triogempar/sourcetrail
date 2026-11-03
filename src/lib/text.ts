const STOP = new Set([
  "that", "this", "with", "from", "have", "were", "been", "their", "about", "which",
  "into", "after", "before", "than", "then", "them", "they", "will", "would", "could",
  "should", "there", "these", "those", "your", "ours", "what", "when", "where", "while",
  "because", "until", "among", "between", "within", "without", "under", "over", "also",
  "such", "other", "another", "some", "many", "most", "more", "does", "did", "doing",
  "each", "both", "only", "same", "onto", "upon", "very", "just", "like", "into",
]);

const STOP_CAPS = new Set([
  "The", "A", "An", "In", "On", "Of", "For", "And", "But", "Or", "If", "When", "While",
  "This", "That", "These", "Those", "Neither", "Both", "It", "Its", "They", "Their",
  "After", "Before", "During", "Within", "Without", "From", "By", "To", "As", "At",
  "Into", "Over", "Under", "Not", "No", "Yes", "Some", "Many", "Most", "More", "Such",
  "Other", "Another", "There", "Here", "One", "Two", "Three", "Four", "Five", "Until",
  "Because", "Researchers", "Reports", "Report",
]);

export function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 3))}...`;
}

export function cleanSentence(text: string): string {
  return text.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function contentWords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
  return words.filter((word) => word.length >= 4 && !STOP.has(word));
}

export function numberTokens(text: string): string[] {
  const normalized = text.toLowerCase().replace(/(\d+(?:\.\d+)?)\s*(percent|per cent)/g, "$1%");
  return normalized.match(/-?\d+(?:\.\d+)?%?/g) ?? [];
}

export function properNouns(sentence: string): string[] {
  const matches = sentence.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
  const seen = new Set<string>();
  const nouns: string[] = [];
  for (const word of matches) {
    if (STOP_CAPS.has(word)) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    nouns.push(word);
  }
  return nouns;
}

export function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(haystack);
}

export function publisherFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Unknown publisher";
  }
}

export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
  } catch {
    return url.trim();
  }
}

export function safeHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function formatDate(value: string | null): string {
  if (!value) return "Date not reported";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return clip(value, 40);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function findSupportSpan(sentence: string, passage: string): { start: number; end: number } | null {
  const words = contentWords(sentence);
  const gap = "(?:\\W+\\w+){0,4}\\W+";
  for (let size = Math.min(8, words.length); size >= 4; size -= 1) {
    for (let index = 0; index + size <= words.length; index += 1) {
      const pattern = words.slice(index, index + size).map(escapeRegExp).join(gap);
      const match = new RegExp(pattern, "i").exec(passage);
      if (match && match.index >= 0) {
        return { start: match.index, end: match.index + match[0].length };
      }
    }
  }
  for (const token of numberTokens(sentence)) {
    const match = new RegExp(escapeRegExp(token), "i").exec(passage);
    if (match && match.index >= 0) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

export function heuristicRewrite(query: string, question: string): string {
  const cleaned = query.replace(/[?]+/g, "").replace(/\s+/g, " ").trim();
  const year = question.match(/\b20\d{2}\b/)?.[0];
  const candidates = [
    year && !cleaned.includes(year) ? `${cleaned} ${year}` : "",
    `${cleaned} official report`,
    `${cleaned} primary source`,
  ].filter((candidate) => candidate.length > 0);
  const next = candidates.find((candidate) => candidate.toLowerCase() !== query.trim().toLowerCase());
  return (next ?? `${cleaned} evidence`).slice(0, 180);
}

export function withTimeout(parent: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!parent) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([parent, timeout]);
  return timeout;
}
