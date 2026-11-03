import { formatDate } from "@/lib/text";
import type { Brief, Sentence, VerificationSummary } from "@/lib/types";

export function citationOrder(brief: Pick<Brief, "lede" | "sections" | "conflicts">): string[] {
  const order: string[] = [];
  const push = (sentence: Sentence) => {
    for (const id of sentence.citations) {
      if (!order.includes(id)) order.push(id);
    }
  };
  brief.lede.forEach(push);
  brief.sections.forEach((section) => section.sentences.forEach(push));
  brief.conflicts.forEach((conflict) => conflict.sides.forEach((side) => side.sentences.forEach(push)));
  return order;
}

export function footnoteNumber(order: string[], id: string): number {
  const index = order.indexOf(id);
  return index === -1 ? 0 : index + 1;
}

function renderSentence(sentence: Sentence, order: string[]): string {
  const marks = sentence.citations
    .map((id) => footnoteNumber(order, id))
    .filter((number) => number > 0)
    .map((number) => `[^${number}]`)
    .join("");
  const prefix = sentence.kind === "inference" ? "*(inference)* " : sentence.flag === "partial" ? "*(check)* " : "";
  return `${prefix}${sentence.text}${marks}`;
}

export function briefToMarkdown(brief: Brief, summary: VerificationSummary | null): string {
  const order = citationOrder(brief);
  const lines: string[] = [
    `# ${brief.headline}`,
    "",
    `Question: ${brief.question}`,
    "",
  ];
  if (brief.insufficient) {
    lines.push("## Not yet answered", "");
    if (brief.gaps.length === 0) lines.push("The retrieved passages do not answer the question.");
    brief.gaps.forEach((gap) => lines.push(`- ${gap}`));
    lines.push("", "### What was searched", "");
    brief.searched.forEach((item) => {
      lines.push(`- ${item.subquestion}`);
      if (item.queries.length > 0) lines.push(`  - Queries: ${item.queries.join("; ")}`);
    });
    lines.push("");
  }
  if (brief.lede.length > 0) {
    lines.push(brief.lede.map((sentence) => renderSentence(sentence, order)).join(" "), "");
  }
  for (const section of brief.sections) {
    lines.push(`## ${section.heading}`, "", section.sentences.map((sentence) => renderSentence(sentence, order)).join(" "), "");
  }
  if (brief.conflicts.length > 0) {
    lines.push("## Sources disagree", "");
    for (const conflict of brief.conflicts) {
      lines.push(`### ${conflict.topic}`, "");
      for (const side of conflict.sides) {
        lines.push(`**${side.label}.** ${side.sentences.map((sentence) => renderSentence(sentence, order)).join(" ")}`, "");
      }
    }
  }
  if (!brief.insufficient && brief.gaps.length > 0) {
    lines.push("## Not yet answered", "");
    brief.gaps.forEach((gap) => lines.push(`- ${gap}`));
    lines.push("");
  }
  if (!brief.insufficient) {
    lines.push("## What was searched", "");
    brief.searched.forEach((item) => {
      lines.push(`- ${item.subquestion}`);
      if (item.queries.length > 0) lines.push(`  - Queries: ${item.queries.join("; ")}`);
    });
    lines.push("");
  }
  if (summary) {
    lines.push(
      "## Verification",
      "",
      `${summary.checked} checked, ${summary.supported} supported, ${summary.flagged} flagged, ${summary.dropped} struck, ${summary.inferences} inferences.`,
      "",
      summary.note,
      "",
    );
    if (summary.droppedSentences.length > 0) {
      lines.push("Struck:", "");
      summary.droppedSentences.forEach((sentence) => lines.push(`- ${sentence.text} — ${sentence.reason}`));
      lines.push("");
    }
  }
  if (order.length > 0) {
    lines.push("## Footnotes", "");
    order.forEach((id, index) => {
      const passage = brief.passages.find((item) => item.id === id);
      if (!passage) return;
      lines.push(
        `[^${index + 1}]: ${passage.publisher}. "${passage.title}." ${formatDate(passage.publishedDate)}. ${passage.url}`,
        "",
        `> ${passage.text}`,
        "",
      );
    });
  }
  const unread = brief.passages.filter((passage) => !order.includes(passage.id));
  if (unread.length > 0) {
    lines.push("## Passages read, not cited", "");
    unread.forEach((passage) => {
      lines.push(`- ${passage.publisher}. "${passage.title}." ${passage.url}`);
    });
    lines.push("");
  }
  if (brief.models.mode === "mock") {
    lines.push("Fixture desk. Nebius and Tavily were not called.", "");
  } else {
    lines.push(`Drafted with ${brief.models.primary}. Checked with ${brief.models.verify}.`, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
