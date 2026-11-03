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

export function assessSupport(sentence: string, passages: string[]): Support {
  if (passages.length === 0) {
    return { level: "unsupported", reason: "No cited passage was stored." };
  }
  const cleanSentence = stripWebAddresses(sentence);
  const cleanPassages = passages.map((passage) => stripWebAddresses(passage));
  const haystack = cleanPassages.join("\n");
  const missingNumber = numberTokens(cleanSentence).find((token) => !numberSatisfied(token, haystack));
  if (missingNumber) {
    return { level: "unsupported", reason: `The figure ${missingNumber} is not in the cited passage.` };
  }
  const missingNames = properNouns(cleanSentence).filter((name) => !cleanPassages.some((passage) => nameInText(name, passage)));
  const words = contentWords(cleanSentence).filter((word) => !missingNames.some((name) => name.toLowerCase().split(/\s+/).includes(word)));
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
    return { level: "supported", reason: "The cited passage supports the wording." };
  }
  if (coverage >= 0.38) {
    return { level: "partial", reason: "Only part of the wording matches the cited passage." };
  }
  return { level: "unsupported", reason: "The wording is not supported by the cited passage." };
}
