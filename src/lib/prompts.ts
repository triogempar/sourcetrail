import type { Passage } from "@/lib/types";

type PromptSentence = {
  id: string;
  text: string;
  kind: string;
  citations: string[];
};

const JSON_ONLY = "Reply with one JSON object and no markdown fence.";

export function planPrompt(question: string): { system: string; user: string } {
  return {
    system: [
      "You plan a sourced research inquiry. You do not answer the question.",
      "Break it into 4 sub-questions (3 if it is narrow, never more than 5).",
      "Each sub-question needs a web search query a journalist would type.",
      "Set recency true when the answer depends on recent events, a named recent period, or words like today, this week, or latest.",
      "When recency is true, set topic to news and timeRange to day, week, month, or year.",
      "Set language to the language of the question, such as en or id.",
      JSON_ONLY,
      `Schema: {"language":"en","recency":false,"timeRange":null,"topic":"general","subquestions":[{"id":"sq1","question":"...","query":"...","needsRecency":false}]}`,
    ].join(" "),
    user: `Question:\n${question}`,
  };
}

export function rewritePrompt(input: {
  question: string;
  subquestion: string;
  previous: string;
  problem: string;
}): { system: string; user: string } {
  return {
    system: `You rewrite a weak web search query. Return JSON {"query":"..."} and nothing else. The new query must differ from the previous one and stay under 180 characters.`,
    user: `Question: ${input.question}\nSub-question: ${input.subquestion}\nPrevious query: ${input.previous}\nProblem: ${input.problem}`,
  };
}

export function writePrompt(input: {
  question: string;
  language: string;
  passages: Passage[];
}): { system: string; user: string } {
  const passages = input.passages
    .map((passage) => `[${passage.id}] ${passage.publisher} | ${passage.publishedDate ?? "undated"} | ${passage.title} | ${passage.url}\n"""${passage.text}"""`)
    .join("\n\n");
  return {
    system: [
      "You write a short research brief grounded only in the stored sources below.",
      `Write every user-facing string, including section headings, in the language of the question. Language: ${input.language}.`,
      "Stay compact: at most 6 sentences in the whole brief, each under 220 characters. Answer in lede first.",
      "kind fact is allowed only when the cited sources state it. Copy figures and names exactly. Every fact needs citation ids such as p1 in the citations array only. Never write (p1) or p1 inside the sentence.",
      "Name the publisher in ordinary prose. Never paste a raw domain, URL, or the word passage. Bad: 'Passage dari repository1.example.ac.id menyebut'. Good: 'Jurnal Kesehatan melaporkan'.",
      "Do not inherit the source's first person. If a source says we, our, or I, attribute it, for example 'Harbor Desk called both figures highs for its poll.'",
      "The headline is a finished phrase in the question language. Do not end it with an ellipsis or a cut-off word.",
      "Do not repeat a sentence in a later section.",
      "kind inference is a conclusion the passages support without stating it in those words. An inference must not add numbers, dates, or names absent from the passages.",
      "If two passages make incompatible claims, put both in conflicts and do not pick a winner.",
      "If the passages do not answer the question, set insufficient true, keep lede empty or limited to what the passages literally say, and list the gaps.",
      "Do not use world knowledge to fill a gap.",
      JSON_ONLY,
      `Schema: {"headline":"...","insufficient":false,"lede":[{"text":"...","kind":"fact","citations":["p1"]}],"sections":[{"heading":"...","sentences":[]}],"conflicts":[{"topic":"...","sides":[{"label":"...","sentences":[{"text":"...","kind":"fact","citations":["p2"]}]}]}],"gaps":["..."]}`,
    ].join(" "),
    user: `Question:\n${input.question}\n\nSources:\n${passages}`,
  };
}

export function verifyPrompt(sentences: PromptSentence[], passages: Passage[]): { system: string; user: string } {
  const blocks = sentences.map((sentence) => {
    const cited = sentence.citations.map((id) => {
      const passage = passages.find((item) => item.id === id);
      return passage ? `[${id}] ${passage.text}` : `[${id}] missing passage`;
    }).join("\n");
    return `id: ${sentence.id}\nkind: ${sentence.kind}\ntext: ${sentence.text}\ncited:\n${cited || "(none)"}`;
  }).join("\n\n");
  return {
    system: [
      "You check whether each sentence is entailed by its cited passages.",
      "Use only the passages in the prompt. Outside knowledge is not evidence.",
      "Mark unsupported when a number, date, or name in the sentence is absent from the cited passages.",
      "Mark partial when the passage supports only part of the sentence.",
      "Inferences may be supported without a verbatim match, but they are unsupported if they add new figures or names.",
      JSON_ONLY,
      `Schema: {"sentences":[{"id":"s1","verdict":"supported","reason":"figure matches"}]}`,
      "verdict is supported, unsupported, or partial. Each reason is at most 8 words.",
    ].join(" "),
    user: blocks,
  };
}
