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

export function uniqueGaps(gaps: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const gap of gaps) {
    const trimmed = gap.trim();
    const key = trimmed.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
    if (unique.length >= 8) break;
  }
  return unique;
}

export function cleanHeadline(text: string): string {
  return cleanSentence(text).replace(/(?:\u2026|\.{3,})\s*$/u, "").trim();
}

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

const FUNCTION_WORDS = new Set([
  ...STOP,
  ...[...STOP_CAPS].map((word) => word.toLowerCase()),
  "berdasarkan", "menurut", "dalam", "pada", "untuk", "dengan", "bahwa", "ini", "itu",
  "dan", "atau", "tetapi", "namun", "serta", "dari", "yang", "adalah", "hasil", "studi",
  "penelitian", "para", "sebuah", "beberapa", "tidak", "juga", "oleh", "akan", "dapat",
  "bisa", "telah", "sudah", "masih", "secara", "antara", "terhadap", "karena", "jika",
  "ketika", "setelah", "sebelum", "selain", "meski", "meskipun", "walau", "walaupun",
  "jadi", "maka", "lalu", "selama", "tanpa", "atas", "bagi", "para", "mereka", "kami",
  "kita", "saya", "anda", "hal", "hasilnya", "demikian", "oleh karena",
]);

const NUMBER_WORDS: Record<string, string[]> = {
  "0": ["zero", "nol"],
  "1": ["one", "satu"],
  "2": ["two", "dua"],
  "3": ["three", "tiga"],
  "4": ["four", "empat"],
  "5": ["five", "lima"],
  "6": ["six", "enam"],
  "7": ["seven", "tujuh"],
  "8": ["eight", "delapan"],
  "9": ["nine", "sembilan"],
  "10": ["ten", "sepuluh"],
  "11": ["eleven", "sebelas"],
  "12": ["twelve", "dua belas"],
};

export function stripCitationTags(text: string): string {
  return text.replace(/\s*[([]\s*p\s*\d+(?:\s*[,;]\s*p\s*\d+)*\s*[)\]]/gi, "");
}

/** Drop URLs and hostnames so digits inside repository1.example.ac.id are not figures. */
export function stripWebAddresses(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/gi, " ");
}

/** Fold 26/27 and 2026/27 into the same season token. Other numbers stay as written. */
export function numberTokens(text: string): string[] {
  const normalized = stripWebAddresses(stripCitationTags(text)).toLowerCase().replace(/(\d+(?:\.\d+)?)\s*(percent|per cent)/g, "$1%");
  const seasons: string[] = [];
  const withoutSeasons = normalized.replace(/\b(\d{2}|\d{4})\s*[/\u2013-]\s*(\d{2})\b/g, (match, left: string, right: string) => {
    const leftYear = Number(left.length === 4 ? left.slice(-2) : left);
    const rightYear = Number(right);
    if ((leftYear + 1) % 100 === rightYear) {
      seasons.push(`${String(leftYear).padStart(2, "0")}/${right}`);
      return " ";
    }
    return match;
  });
  const singles = withoutSeasons.match(/-?\d+(?:\.\d+)?%?/g) ?? [];
  return [...seasons, ...singles];
}

export function numberSatisfied(token: string, passage: string): boolean {
  const available = new Set(numberTokens(passage));
  if (available.has(token)) return true;
  const bare = token.endsWith("%") ? token.slice(0, -1) : token;
  const percent = token.endsWith("%") ? token : `${token}%`;
  if (available.has(bare) || available.has(percent)) return true;
  const words = NUMBER_WORDS[bare];
  if (words?.some((word) => new RegExp(`\\b${word}\\b`, "i").test(passage))) return true;
  const target = Number(bare);
  if (!Number.isFinite(target) || bare.includes(".")) return false;
  for (const match of passage.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:-|–|—|to|sampai)\s*(\d+(?:\.\d+)?)\b/gi)) {
    const diff = Math.abs(Number(match[1]) - Number(match[2]));
    if (Math.abs(diff - target) < 0.051) return true;
  }
  return false;
}

const SLUG_BRANDS: Record<string, string> = {
  nytimes: "New York Times",
  phillyburbs: "PhillyBurbs",
  livenowfox: "Fox",
  foxnews: "Fox",
  cuanschutz: "CU Anschutz",
  frontiersin: "Frontiers",
  withpower: "WithPower",
  poltekkesjakarta: "Poltekkes Jakarta",
  "lppm-stikesfa": "LPPM Stikesfa",
  stikesfa: "LPPM Stikesfa",
  unismuhpalu: "Universitas Muhammadiyah Palu",
  unismuh: "Universitas Muhammadiyah Palu",
  stikeselisabethmedan: "STIKes Elisabeth Medan",
  mdpi: "MDPI",
  veeva: "Veeva",
};

export function naturalizeSentence(text: string): string {
  let next = stripCitationTags(text)
    .replace(/\bHealth detik\b/g, "detikHealth")
    .replace(
      /^(?:the\s+)?passages?\s+(?:dari|from)\s+([^,:.]{2,80}?)\s+(?:menyebut(?:kan)?|menyatakan|mengatakan|melaporkan|menulis|says|said|reports|reported|notes|noted|writes|wrote)\s*(?:,|:|bahwa|that)?\s*/iu,
      "$1: ",
    );
  for (const [slug, brand] of Object.entries(SLUG_BRANDS)) {
    next = next.replace(new RegExp(`\\b${escapeRegExp(slug)}\\b`, "gi"), brand);
  }
  next = next.replace(
    /\b(?:[a-z0-9-]+\.)+(?:co\.id|ac\.id|or\.id|go\.id|sch\.id|com|org|net|edu|io)\b/gi,
    (host) => readablePublisher(host),
  );
  return next.replace(/\s{2,}/g, " ").trim();
}

export function loneAccountHeading(language: string): string {
  const lang = language.toLowerCase();
  if (/^id\b|indones/.test(lang)) return "Yang tetap tercatat";
  if (lang.startsWith("es")) return "Lo que sí consta";
  if (lang.startsWith("fr")) return "Ce qu'une source a rapporté";
  return "Reported without a second account";
}

function isCapitalizedWord(word: string): boolean {
  const first = word.charAt(0);
  return first !== first.toLowerCase() && first === first.toUpperCase();
}

export function properNouns(sentence: string): string[] {
  const clauses = sentence.split(/(?<=[.!?])\s+/);
  const seen = new Set<string>();
  const nouns: string[] = [];
  for (const clause of clauses) {
    const words = clause.match(/\p{L}[\p{L}'’-]*/gu) ?? [];
    const rest = words.slice(1);
    let index = 0;
    while (index < rest.length) {
      const word = rest[index] ?? "";
      if (!isCapitalizedWord(word) || FUNCTION_WORDS.has(word.toLowerCase())) {
        index += 1;
        continue;
      }
      const phrase = [word];
      let next = index + 1;
      while (next < rest.length) {
        const follow = rest[next] ?? "";
        if (!isCapitalizedWord(follow) || FUNCTION_WORDS.has(follow.toLowerCase())) break;
        phrase.push(follow);
        next += 1;
      }
      const label = phrase.join(" ");
      const key = label.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        nouns.push(label);
      }
      index = next;
    }
  }
  return nouns;
}

function foldName(value: string): string {
  return value.toLowerCase().replace(/\bpublic\b/g, "").replace(/[^a-z0-9]+/g, "");
}

export function nameInText(name: string, passage: string): boolean {
  if (hasWord(passage, name)) return true;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  const phrase = parts.map((part) => escapeRegExp(part)).join("(?:\\W+\\w+){0,8}\\W+");
  if (new RegExp(phrase, "i").test(passage)) return true;
  const initials = parts.map((part) => part.charAt(0)).join("");
  if (new RegExp(`\\b${initials}\\b`, "i").test(passage)) return true;
  const dotted = parts.map((part) => `${escapeRegExp(part.charAt(0))}\\.`).join("\\s*");
  if (new RegExp(`\\b${dotted}`, "i").test(passage)) return true;
  const words = parts.filter((part) => part.length >= 3 && !FUNCTION_WORDS.has(part.toLowerCase()));
  if (words.length >= 2 && words.every((part) => hasWord(passage, part))) return true;
  const folded = foldName(name);
  return folded.length >= 8 && foldName(passage).includes(folded);
}

const PUBLISHER_TLDS = new Set(["com", "org", "net", "edu", "gov", "ac", "id", "uk", "au", "sg", "my", "io", "ai", "co", "go", "sch", "int"]);

function isWeakPublisher(name: string): boolean {
  const tokens = name.toLowerCase().split(/[\s.]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length === 1 && tokens[0]!.length <= 5) return true;
  return tokens.every((token) => token.length <= 3);
}

function looksTruncated(text: string): boolean {
  return /[…\u2026]|\.{3}/.test(text);
}

function looksLikeArticle(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || looksTruncated(trimmed)) return true;
  if (trimmed.length > 48) return true;
  return /^(pengaruh|the effect|the impact|studi |analisis |hubungan |dampak |effect of |association )/i.test(trimmed);
}

function looksLikePageTitle(name: string): boolean {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return false;
  return tokens.slice(1).every((token) => {
    const first = token.charAt(0);
    return first !== first.toUpperCase() || first === first.toLowerCase();
  });
}

function publicationName(title?: string): string | null {
  if (!title || looksTruncated(title)) return null;
  const parts = title.split(/\s+[|–—]\s+|\s+-\s+/).map((part) => part.trim()).filter((part) => part.length >= 4 && part.length <= 60);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1] ?? "";
  if (!last || looksLikeArticle(last) || looksLikePageTitle(last) || last.length > 40) return null;
  return last;
}

function hostOf(raw?: string): string {
  if (!raw) return "";
  const trimmed = raw.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (!trimmed.includes(".")) return "";
  return (trimmed.split("/")[0] ?? "").toLowerCase();
}

function brandFromHost(host: string): string | null {
  if (!host) return null;
  const labels = host.split(".").filter((label) => label && !PUBLISHER_TLDS.has(label));
  if (labels[labels.length - 1] === "detik") {
    const section = (labels[labels.length - 2] ?? "").replace(/\d+$/g, "");
    if (!section) return "detik";
    return `detik${section.charAt(0).toUpperCase()}${section.slice(1)}`;
  }
  for (const label of labels) {
    const known = SLUG_BRANDS[label];
    if (known) return known;
  }
  return null;
}

function isHumanPublisher(name: string): boolean {
  if (!name || name.includes("://") || /\s/.test(name) === false) return false;
  if (looksLikeArticle(name) || looksTruncated(name) || looksLikePageTitle(name)) return false;
  if (SLUG_BRANDS[name.toLowerCase()]) return false;
  const tokens = name.split(/\s+/).filter(Boolean);
  return tokens.length >= 2 && tokens.every((token) => token.length <= 28);
}

function prettifyHyphen(label: string): string | null {
  if (!label.includes("-")) return null;
  const parts = label.split("-").filter(Boolean);
  if (parts.length < 2) return null;
  return parts.map((part) => (part.length <= 4 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)).join(" ");
}

export function readablePublisher(name: string, title?: string, url?: string): string {
  const trimmed = name.trim();
  if (/^health\s+detik$/i.test(trimmed) || /^detik\s+health$/i.test(trimmed)) return "detikHealth";
  const known = brandFromHost(hostOf(url) || hostOf(trimmed)) || SLUG_BRANDS[trimmed.toLowerCase()] || null;
  if (isHumanPublisher(trimmed)) return trimmed;
  const journal = publicationName(title);
  if (journal && !SLUG_BRANDS[journal.toLowerCase()]) return journal;
  if (known) return known;
  const hyphen = prettifyHyphen(hostOf(url).split(".")[0] ?? "") || prettifyHyphen(trimmed.toLowerCase());
  if (hyphen) return hyphen;
  if (trimmed && !looksLikeArticle(trimmed) && !looksLikePageTitle(trimmed) && !trimmed.includes(".") && !/^(?:source|sumber)$/i.test(trimmed) && !isWeakPublisher(trimmed)) {
    return trimmed;
  }
  const brand = fallbackBrand(url || trimmed) || fallbackBrand(trimmed);
  if (brand) return brand;
  if (trimmed && !/^(?:source|sumber)$/i.test(trimmed)) return trimmed;
  return "the site";
}

function hostLabels(host: string): string[] {
  return host.split(".").filter((label) => label && !PUBLISHER_TLDS.has(label) && label !== "www");
}

function fallbackBrand(raw: string): string | null {
  if (!raw || /^(?:source|sumber)$/i.test(raw.trim())) return null;
  const host = hostOf(raw) || raw.trim().toLowerCase().replace(/^www\./, "");
  const labels = hostLabels(host);
  if (labels.length === 0) return null;
  for (const label of labels) {
    const known = SLUG_BRANDS[label];
    if (known) return known;
  }
  const core = labels[labels.length - 1] ?? "";
  if (core.length < 2) return null;
  if (core.length <= 4) return core.toUpperCase();
  return `${core.charAt(0).toUpperCase()}${core.slice(1)}`;
}

const REGIONS: string[][] = [
  ["united states", "u.s.", "usa", "amerika", "america", "kingman", "downey", "arizona", "california", "facebook"],
  ["indonesia", "bandung", "jakarta", "braga", "jawa", "bali", "surabaya", "yogyakarta"],
  ["iberia", "iberian", "spain", "spanish", "portugal", "portuguese", "caceres", "alentejo", "extremadura", "madrid"],
  ["germany", "german", "hamburg", "berlin"],
];

function regionsIn(text: string): Set<number> {
  const haystack = text.toLowerCase();
  const found = new Set<number>();
  REGIONS.forEach((names, index) => {
    if (names.some((name) => haystack.includes(name))) found.add(index);
  });
  return found;
}

const PLACE_WORDS = new Set(
  REGIONS.flatMap((names) => names.flatMap((name) => name.toLowerCase().split(/[\s.]+/).filter((part) => part.length >= 4))),
);

/** Shared subject words, ignoring place names. Two or more means the sentence is on the question. */
export function subjectOverlap(question: string, text: string): number {
  const wanted = new Set(contentWords(question).filter((word) => !PLACE_WORDS.has(word)));
  const found = new Set<string>();
  for (const word of contentWords(text)) {
    if (wanted.has(word)) found.add(word);
  }
  return found.size;
}

/** A supported sentence about a different place than the question asks about. */
export function offTopicReason(question: string, sentence: string): string | null {
  const wanted = regionsIn(question);
  if (wanted.size === 0) return null;
  const mentioned = regionsIn(sentence);
  if (mentioned.size === 0) return null;
  for (const region of mentioned) {
    if (wanted.has(region)) return null;
  }
  return "The sentence is about a different place than the question.";
}

export type BriefLabels = {
  insufficient: string;
  contested: string;
  brief: string;
  disagree: string;
  unanswered: string;
  searched: string;
  kept: string;
  unread: string;
  verification: string;
  inference: string;
  check: string;
  struck: string;
  notRun: string;
  instead: string;
  copy: string;
  download: string;
  copied: string;
  passages: (count: number) => string;
  checked: (count: number) => string;
  unchecked: string;
  fixture: string;
};

export function briefLabels(language: string): BriefLabels {
  if (/^id\b|indones/i.test(language)) {
    return {
      insufficient: "Bukti tidak cukup",
      contested: "Sumber berbeda",
      brief: "Ringkasan riset",
      disagree: "Sumber tidak sependapat",
      unanswered: "Belum terjawab",
      searched: "Yang dicari",
      kept: "Kutipan yang disimpan",
      unread: "Dibaca, tidak dikutip",
      verification: "Pemeriksaan",
      inference: "Inferensi",
      check: "Periksa",
      struck: "Dicoret",
      notRun: "Tidak dijalankan",
      instead: "Yang ditemukan sebagai gantinya",
      copy: "Salin Markdown",
      download: "Unduh",
      copied: "Tersalin",
      passages: (count) => `${count} kutipan`,
      checked: (count) => `${count} klaim diperiksa`,
      unchecked: "Belum diperiksa",
      fixture: "Meja contoh",
    };
  }
  return {
    insufficient: "Insufficient evidence",
    contested: "Contested record",
    brief: "Research brief",
    disagree: "Sources disagree",
    unanswered: "Not yet answered",
    searched: "What was searched",
    kept: "Passages kept",
    unread: "Read, not cited",
    verification: "Verification",
    inference: "Inference",
    check: "Check",
    struck: "Struck",
    notRun: "Not run",
    instead: "What we found instead",
    copy: "Copy Markdown",
    download: "Download",
    copied: "Copied",
    passages: (count) => `${count} ${count === 1 ? "passage" : "passages"}`,
    checked: (count) => `${count} ${count === 1 ? "claim" : "claims"} checked`,
    unchecked: "Unchecked",
    fixture: "Fixture desk",
  };
}

export function planFrameTitle(language: string, recency: boolean, timeRange: string | null): string {
  const indonesian = /^id\b|indones/i.test(language);
  if (!recency) return indonesian ? "Tanpa saringan waktu" : "No time filter";
  const names: Record<string, string> = indonesian
    ? { day: "hari", week: "minggu", month: "bulan", year: "tahun" }
    : { day: "day", week: "week", month: "month", year: "year" };
  const range = names[timeRange ?? "month"] ?? (timeRange ?? "month");
  return indonesian ? `Rentang waktu: ${range}` : `Time range: ${range}`;
}

export function trailPhaseLabel(language: string, phase: string): string {
  const indonesian = /^id\b|indones/i.test(language);
  const labels: Record<string, string> = indonesian
    ? { plan: "Rencana", search: "Cari", read: "Baca", write: "Tulis", verify: "Periksa", gap: "Celah", done: "Selesai" }
    : { plan: "Plan", search: "Search", read: "Read", write: "Write", verify: "Verify", gap: "Gap", done: "Done" };
  return labels[phase] ?? phase;
}

export function recencyDetail(language: string, recent: boolean): string {
  const indonesian = /^id\b|indones/i.test(language);
  if (recent) return indonesian ? "Sumber terbaru diutamakan." : "Recent sources preferred.";
  return indonesian ? "Baris ini tidak memakai saringan waktu." : "No recency filter on this line.";
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

export function formatDate(value: string | null, language = "en"): string {
  if (!value) return /^id\b|indones/i.test(language) ? "Tanggal tidak dilaporkan" : "Date not reported";
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
