"use client";

import { useEffect, useRef } from "react";
import { findSupportSpan, formatDate, safeHttpUrl } from "@/lib/text";
import type { Passage } from "@/lib/types";

export function SourceSheet({
  passage,
  claim,
  number,
  mock,
  onClose,
}: {
  passage: Passage;
  claim: string;
  number: number;
  mock: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const href = safeHttpUrl(passage.url);
  const span = findSupportSpan(claim, passage.text);

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
      <button type="button" className="backdrop" aria-label="Close source" onClick={onClose} />
      <aside
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-title"
      >
        <div className="sheet-top">
          <div>
            <p className="kicker">Note {number}</p>
            <h2 id="source-title">{passage.publisher}</h2>
          </div>
          <button ref={closeRef} type="button" className="ghost" onClick={onClose}>Close</button>
        </div>
        <p className="meta-line">{passage.title}</p>
        <p className="meta-line">{formatDate(passage.publishedDate)} · {passage.origin === "extract" ? "Extracted passage" : "Search snippet"}{mock ? " · Fixture" : ""}</p>
        <p className="claim">{claim}</p>
        <p className="passage">
          {span ? (
            <>
              {passage.text.slice(0, span.start)}
              <mark className="support">{passage.text.slice(span.start, span.end)}</mark>
              {passage.text.slice(span.end)}
            </>
          ) : passage.text}
        </p>
        {!span ? <p className="passage-note">No contiguous span matched this sentence. Read the passage against the claim.</p> : null}
        {href ? (
          <a className="outlink" href={href} target="_blank" rel="noreferrer">Open source</a>
        ) : null}
      </aside>
    </div>
  );
}
