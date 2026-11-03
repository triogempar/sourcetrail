"use client";

import { useMemo, useState } from "react";
import { briefToMarkdown, citationOrder, footnoteNumber } from "@/lib/markdown";
import { briefLabels, formatDate } from "@/lib/text";
import type { InquiryOutcome } from "@/lib/stream-state";
import type { Brief, Sentence, VerificationSummary } from "@/lib/types";

export function BriefView({
  brief,
  summary,
  outcome,
  onCite,
  activePassageId,
}: {
  brief: Brief;
  summary: VerificationSummary | null;
  outcome: InquiryOutcome;
  onCite: (passageId: string, claim: string) => void;
  activePassageId: string | null;
}) {
  const order = useMemo(() => citationOrder(brief), [brief]);
  const [copied, setCopied] = useState(false);
  const markdown = useMemo(() => briefToMarkdown(brief, summary), [brief, summary]);

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      downloadMarkdown();
    }
  }

  function downloadMarkdown() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sourcetrail-brief.md";
    link.click();
    URL.revokeObjectURL(url);
  }

  const labels = briefLabels(brief.language);
  const gaps = (
    <section className="gaps" aria-label={labels.unanswered}>
      <h2>{labels.unanswered}</h2>
      {brief.gaps.length === 0 ? <p>{labels.unanswered}</p> : (
        <ul>{brief.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
      )}
      <h3>{labels.searched}</h3>
      <ul className="search-log">
        {brief.searched.map((item) => (
          <li key={item.subquestion}>
            <p>{item.subquestion}</p>
            <p className="query">{item.queries.length > 0 ? item.queries.join("  ·  ") : labels.notRun}</p>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <article className="brief" data-outcome={outcome} aria-label="Research brief">
      <header className="brief-head">
        <div>
          <p className="kicker">
            {brief.insufficient ? labels.insufficient : brief.conflicts.length > 0 ? labels.contested : labels.brief}
          </p>
          <h1>{brief.headline}</h1>
          <p className="asked">{brief.question}</p>
          <p className="dateline">
            <span>{brief.passages.length} passages</span>
            <span>{summary ? `${summary.checked} claims checked` : "Unchecked"}</span>
            <span>{brief.models.mode === "mock" ? "Fixture desk" : brief.models.primary}</span>
          </p>
        </div>
        <div className="export">
          <button type="button" className="ghost" onClick={() => void copyMarkdown()}>{copied ? labels.copied : labels.copy}</button>
          <button type="button" className="ghost" onClick={downloadMarkdown}>{labels.download}</button>
        </div>
      </header>
      {brief.insufficient ? gaps : null}
      {brief.aside.length > 0 ? (
        <section className="instead" aria-label={labels.instead}>
          <h2>{labels.instead}</h2>
          <ul>{brief.aside.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      ) : null}
      {brief.lede.length > 0 ? (
        <p className="lede">
          {brief.lede.map((sentence) => (
            <SentenceText
              key={sentence.id}
              sentence={sentence}
              order={order}
              labels={labels}
              onCite={onCite}
              activePassageId={activePassageId}
            />
          ))}
        </p>
      ) : null}
      {brief.sections.map((section) => (
        <section className="section" key={section.heading}>
          <h2>{section.heading}</h2>
          <p>
            {section.sentences.map((sentence) => (
              <SentenceText
                key={sentence.id}
                sentence={sentence}
                order={order}
                labels={labels}
                onCite={onCite}
                activePassageId={activePassageId}
              />
            ))}
          </p>
        </section>
      ))}
      {brief.conflicts.length > 0 ? (
        <section className="disagree" aria-label={labels.disagree}>
          <h2>{labels.disagree}</h2>
          {brief.conflicts.map((conflict) => (
            <div key={conflict.topic}>
              <h3>{conflict.topic}</h3>
              <div className="sides">
                {conflict.sides.map((side) => (
                  <div className="side" key={side.label}>
                    <p className="kicker">{side.label}</p>
                    <p>
                      {side.sentences.map((sentence) => (
                        <SentenceText
                          key={sentence.id}
                          sentence={sentence}
                          order={order}
                          labels={labels}
                          onCite={onCite}
                          activePassageId={activePassageId}
                        />
                      ))}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}
      {!brief.insufficient && brief.gaps.length > 0 ? gaps : null}
      {!brief.insufficient && brief.gaps.length === 0 ? (
        <section className="gaps" aria-label={labels.searched}>
          <h2>{labels.searched}</h2>
          <ul className="search-log">
            {brief.searched.map((item) => (
              <li key={item.subquestion}>
                <p>{item.subquestion}</p>
                <p className="query">{item.queries.join("  ·  ")}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {brief.passages.length > 0 ? (
        <section className="source-index" aria-label={labels.kept}>
          <h2>{labels.kept}</h2>
          <ul>
            {brief.passages.map((passage) => {
              const number = footnoteNumber(order, passage.id);
              return (
                <li key={passage.id}>
                  <button type="button" onClick={() => onCite(passage.id, brief.lede[0]?.text || passage.text)}>
                    {number > 0 ? `${number}. ` : `${labels.unread}. `}
                    {passage.publisher}. {passage.title}. {formatDate(passage.publishedDate)}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {summary ? (
        <section className="verification" aria-label={labels.verification}>
          <h2>{labels.verification}</h2>
          <p className="dateline">
            <span>{summary.checked} checked</span>
            <span>{summary.supported} supported</span>
            <span>{summary.flagged} flagged</span>
            <span>{summary.dropped} struck</span>
            <span>{summary.inferences} inferences</span>
          </p>
          <p>{summary.note}</p>
          {summary.droppedSentences.length > 0 ? (
            <>
              <h3>{labels.struck}</h3>
              <ul className="struck">
                {summary.droppedSentences.map((sentence) => (
                  <li key={sentence.text}><span>{sentence.text}</span> {sentence.reason}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}

function SentenceText({
  sentence,
  order,
  labels,
  onCite,
  activePassageId,
}: {
  sentence: Sentence;
  order: string[];
  labels: ReturnType<typeof briefLabels>;
  onCite: (passageId: string, claim: string) => void;
  activePassageId: string | null;
}) {
  return (
    <span className={sentence.kind === "inference" ? "sentence inference" : "sentence fact"}>
      {sentence.kind === "inference" ? <span className="kind">{labels.inference}</span> : null}
      {sentence.flag === "partial" ? <span className="kind">{labels.check}</span> : null}
      {sentence.text}
      {sentence.citations.map((id) => {
        const number = footnoteNumber(order, id);
        if (number === 0) return null;
        return (
          <sup key={id}>
            <button
              type="button"
              className="cite"
              aria-expanded={activePassageId === id}
              aria-label={`Show source ${number}`}
              onClick={() => onCite(id, sentence.text)}
            >
              {number}
            </button>
          </sup>
        );
      })}{" "}
    </span>
  );
}
