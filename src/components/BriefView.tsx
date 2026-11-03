"use client";

import { useMemo, useState } from "react";
import { absenceNote, briefToMarkdown, citationOrder, footnoteNumber, groupBySource } from "@/lib/markdown";
import { briefLabels, clip, formatDate } from "@/lib/text";
import { coerceSentences, type InquiryOutcome } from "@/lib/stream-state";
import type { Brief, Passage, Sentence, VerificationSummary } from "@/lib/types";

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
  const sources = useMemo(() => groupBySource(brief.passages, order), [brief.passages, order]);
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
  const aside = coerceSentences(brief.aside);
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
            <span>{labels.passages(brief.passages.length)}</span>
            <span>{summary ? labels.checked(summary.checked) : labels.unchecked}</span>
            <span>{brief.models.mode === "mock" ? labels.fixture : brief.models.primary}</span>
          </p>
        </div>
        <div className="export">
          <button type="button" className="ghost" onClick={() => void copyMarkdown()}>{copied ? labels.copied : labels.copy}</button>
          <button type="button" className="ghost" onClick={downloadMarkdown}>{labels.download}</button>
        </div>
      </header>
      {brief.insufficient ? gaps : null}
      {brief.lede.length > 0 ? (
        <p className="lede">
          {brief.lede.map((sentence) => (
            <SentenceText
              key={sentence.id}
              sentence={sentence}
              order={order}
              labels={labels}
              language={brief.language}
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
                language={brief.language}
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
                          language={brief.language}
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
      {aside.length > 0 ? (
        <section className="instead" aria-label={labels.instead}>
          <h2>{labels.instead}</h2>
          <ul>
            {aside.map((sentence) => (
              <li key={sentence.id}>
                <SentenceText
                  sentence={sentence}
                  order={order}
                  labels={labels}
                  language={brief.language}
                  onCite={onCite}
                  activePassageId={activePassageId}
                />
              </li>
            ))}
          </ul>
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
      {sources.kept.length > 0 ? (
        <section className="source-index" aria-label={labels.kept}>
          <h2>{labels.kept}</h2>
          <ul>
            {sources.kept.map((group) => (
              <li key={group.url}>
                {group.passages.length === 1 ? (
                  <PassageButton
                    passage={group.passages[0]!}
                    order={order}
                    language={brief.language}
                    claim={brief.lede[0]?.text || group.passages[0]!.text}
                    onCite={onCite}
                  />
                ) : (
                  <>
                    <p>{group.publisher}. {group.title}.</p>
                    <ul>
                      {group.passages.map((passage) => (
                        <li key={passage.id}>
                          <PassageButton
                            passage={passage}
                            order={order}
                            language={brief.language}
                            claim={brief.lede[0]?.text || passage.text}
                            onCite={onCite}
                            hidePublisher
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {sources.unread.length > 0 ? (
        <section className="source-index unread" aria-label={labels.unread}>
          <h2>{labels.unread}</h2>
          <ul>
            {sources.unread.map((group) => (
              <li key={group.url}>
                <button type="button" onClick={() => onCite(group.passages[0]!.id, group.passages[0]!.text)}>
                  {group.publisher}. {group.title}. {formatDate(group.passages[0]!.publishedDate, brief.language)}
                </button>
              </li>
            ))}
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

function PassageButton({
  passage,
  order,
  language,
  claim,
  onCite,
  hidePublisher,
}: {
  passage: Passage;
  order: string[];
  language: string;
  claim: string;
  onCite: (passageId: string, claim: string) => void;
  hidePublisher?: boolean;
}) {
  const number = footnoteNumber(order, passage.id);
  const prefix = number > 0 ? `${number}. ` : "";
  const label = hidePublisher
    ? `${prefix}${clip(passage.text, 96)}`
    : `${prefix}${passage.publisher}. ${passage.title}. ${formatDate(passage.publishedDate, language)}`;
  return (
    <button type="button" onClick={() => onCite(passage.id, claim)}>
      {label}
    </button>
  );
}

function SentenceText({
  sentence,
  order,
  labels,
  language,
  onCite,
  activePassageId,
}: {
  sentence: Sentence;
  order: string[];
  labels: ReturnType<typeof briefLabels>;
  language: string;
  onCite: (passageId: string, claim: string) => void;
  activePassageId: string | null;
}) {
  const note = absenceNote(sentence, order, language);
  return (
    <span className={sentence.kind === "inference" ? "sentence inference" : "sentence fact"}>
      {sentence.kind === "inference" ? <span className="kind">{labels.inference}</span> : null}
      {sentence.flag === "partial" ? <span className="kind">{labels.check}</span> : null}
      {sentence.text}
      {note ? <span className="kind">{note}</span> : null}
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
