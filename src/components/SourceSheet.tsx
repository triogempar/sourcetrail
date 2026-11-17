"use client";

import { useEffect, useRef } from "react";
import { briefLabels, findSupportSpan, formatDate, safeHttpUrl, trimExcerptJunk } from "@/lib/text";
import type { Passage } from "@/lib/types";

export function SourceSheet({
  passage,
  claim,
  number,
  mock,
  language,
  onClose,
}: {
  passage: Passage;
  claim: string;
  number: number;
  mock: boolean;
  language: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const href = safeHttpUrl(passage.url);
  const labels = briefLabels(language);
  const excerpt = trimExcerptJunk(passage.text);
  const span = findSupportSpan(claim, excerpt);
  const origin = passage.origin === "extract" ? labels.quotedFromPage : labels.searchPreview;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const nodes = panelRef.current.querySelectorAll<HTMLElement>("button, a[href]");
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose, passage.id]);

  return (
    <div className="sheet-root">
      <button type="button" className="backdrop" aria-label={labels.closeSource} onClick={onClose} />
      <aside
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-title"
      >
        <div className="sheet-top">
          <div>
            <h2 id="source-title">{labels.sourceHeading(number)}</h2>
            <p className="sheet-publisher">{passage.publisher}</p>
          </div>
          <button ref={closeRef} type="button" className="ghost" onClick={onClose}>{labels.close}</button>
        </div>
        <p className="meta-line">{passage.title}</p>
        <p className="meta-line">{formatDate(passage.publishedDate, language)} · {origin}{mock ? ` · ${labels.fixture}` : ""}</p>
        <section className="sheet-block">
          <h3>{labels.sentenceInBrief}</h3>
          <p className="claim">{claim}</p>
        </section>
        <section className="sheet-block">
          <h3>{labels.quoteFound}</h3>
          <p className="passage">
            {span ? (
              <>
                {excerpt.slice(0, span.start)}
                <mark className="support">{excerpt.slice(span.start, span.end)}</mark>
                {excerpt.slice(span.end)}
              </>
            ) : excerpt}
          </p>
          {!span ? <p className="passage-note">{labels.noHighlight}</p> : null}
        </section>
        {href ? (
          <a className="outlink" href={href} target="_blank" rel="noreferrer">{labels.openOriginal}</a>
        ) : null}
      </aside>
    </div>
  );
}
