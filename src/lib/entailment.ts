import { contentWords, nameInText, numberSatisfied, numberTokens, properNouns, stripWebAddresses } from "@/lib/text";

export type SupportLevel = "supported" | "partial" | "unsupported";

export type Support = {
  level: SupportLevel;
  reason: string;
};

function hasNgram(words: string[], passages: string[], size: number): boolean {
  const blob = passages.map((passage) => contentWords(passage).join(" ")).join(" ");
  for (let index = 0; index + size <= words.length; index += 1) {
    if (blob.includes(words.slice(index, index + size).join(" "))) return true;
  }
  return false;
}

const GENERAL_CLAIM = /\b(rutin|routine|regular(?:ly)?|umumnya|generally|everyday)\b|\bsecara umum\b/i;
const DOSE_SCOPE = /(?:lebih\s+dari|more\s+than|at\s+least|kurang\s+dari|fewer\s+than|>|≥|≤|<=|<)\s*\d+|\d+\s*(?:cangkir|cups)\b/i;

function overstatesScope(sentence: string, passages: string[]): boolean {
  if (!GENERAL_CLAIM.test(sentence) || DOSE_SCOPE.test(sentence)) return false;
  return passages.some((passage) => DOSE_SCOPE.test(passage));
}

export function assessSupport(sentence: string, passages: string[], metadata = ""): Support {
  if (passages.length === 0) {
    return { level: "unsupported", reason: "No cited passage was stored." };
  }
  const cleanSentence = stripWebAddresses(sentence);
  const cleanPassages = passages.map((passage) => stripWebAddresses(passage));
  const meta = stripWebAddresses(metadata);
  const haystack = cleanPassages.join("\n");
  const missingNumber = numberTokens(cleanSentence).find((token) => !numberSatisfied(token, haystack));
  if (missingNumber) {
    return { level: "unsupported", reason: `The figure ${missingNumber} is not in the cited passage.` };
  }
  const inPassage = (name: string) => cleanPassages.some((passage) => nameInText(name, passage));
  const inMetadata = (name: string) => Boolean(meta) && nameInText(name, meta);
  const names = properNouns(cleanSentence);
  const missingNames = names.filter((name) => !inPassage(name) && !inMetadata(name));
  const attributed = names.filter((name) => inMetadata(name) && !inPassage(name));
  const skip = new Set<string>();
  for (const name of [...missingNames, ...attributed]) {
    for (const part of name.toLowerCase().split(/\s+/)) skip.add(part);
  }
  const words = contentWords(cleanSentence).filter((word) => !skip.has(word));
  if (words.length === 0) {
    return { level: "unsupported", reason: "The sentence has no checkable wording." };
  }
  const passageWords = new Set(cleanPassages.flatMap((passage) => contentWords(passage)));
  const coverage = words.filter((word) => passageWords.has(word)).length / words.length;
  const grounded = hasNgram(words, cleanPassages, 4) || coverage >= 0.62;
  if (missingNames.length > 0 && !hasNgram(words, cleanPassages, 4)) {
    return { level: "unsupported", reason: `${missingNames[0]} is not in the cited passage.` };
  }
  if (grounded) {
    if (overstatesScope(cleanSentence, cleanPassages)) {
      return { level: "partial", reason: "The source limits the finding to a narrower comparison than the sentence states." };
    }
    return { level: "supported", reason: "The cited passage supports the wording." };
  }
  if (coverage >= 0.38) {
    return { level: "partial", reason: "Only part of the wording matches the cited passage." };
  }
  return { level: "unsupported", reason: "The wording is not supported by the cited passage." };
}
