"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BriefView } from "@/components/BriefView";
import { SourceSheet } from "@/components/SourceSheet";
import { Trail } from "@/components/Trail";
import { EXAMPLES } from "@/lib/examples";
import type { PublicConfig } from "@/lib/env";
import { footnoteNumber, citationOrder } from "@/lib/markdown";
import { takeNdjson } from "@/lib/ndjson";
import { emptyStream, inquiryOutcome, reduceStream, type StreamState } from "@/lib/stream-state";
import { searchStoppedLabel, trailPhaseLabel } from "@/lib/text";
import type { ResearchEvent } from "@/lib/types";

export function ResearchApp({ config }: { config: PublicConfig }) {
  const fieldId = useId();
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<StreamState>(emptyStream);
  const [running, setRunning] = useState(false);
  const [httpError, setHttpError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ passageId: string; claim: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      event.preventDefault();
      document.getElementById(fieldId)?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fieldId]);

  async function fileQuestion(text: string) {
    const next = text.trim();
    if (running || config.paused || next.length < 8 || next.length > config.maxQuestionLength) return;
    setQuestion(next);
    setHttpError(null);
    setSheet(null);
    setState(emptyStream());
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: next }),
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || contentType.includes("application/json")) {
        setHttpError(await readError(response));
        return;
      }
      if (!response.body) {
        setHttpError("The connection came back empty.");
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        if (done && pending.trim()) pending += "\n";
        const parsed = takeNdjson(pending);
        pending = parsed.rest;
        if (parsed.events.length > 0) {
          const events = parsed.events as ResearchEvent[];
          setState((current) => events.reduce(
            (nextState, event) => reduceStream(nextState, event),
            current,
          ));
        }
        if (done) break;
      }
      setState((current) => {
        if (!current.brief && !current.error && !current.done) {
          return {
            ...current,
            error: "The connection closed before we could finish an answer.",
            failed: true,
            done: true,
            phase: "done",
            phaseMessage: "Search stopped",
          };
        }
        return current;
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setState((current) => current.brief ? current : {
          ...current,
          error: "Search stopped before we could finish an answer.",
          failed: true,
          done: true,
          phase: "done",
          phaseMessage: "Search stopped",
        });
        return;
      }
      setHttpError(error instanceof Error ? plainError(error.message) : "Search stopped.");
    } finally {
      setRunning(false);
    }
  }

  const visibleError = plainError(httpError || state.error || "");
  const outcome = httpError ? "error" : inquiryOutcome(state, running);
  const examples = EXAMPLES.filter((example) => config.mock || !example.mockOnly);
  const passage = state.brief?.passages.find((item) => item.id === sheet?.passageId) ?? null;
  const noteNumber = state.brief && sheet ? footnoteNumber(citationOrder(state.brief), sheet.passageId) : 0;
  const tooLong = question.length > config.maxQuestionLength;
  const remaining = config.maxQuestionLength - question.length;
  const nearLimit = remaining <= 80;

  return (
    <>
      <a className="skip" href="#brief-column">Skip to the answer</a>
      <div className="page">
        <header className="nameplate">
          {state.brief || visibleError ? <p className="wordmark">SourceTrail</p> : <h1 className="wordmark">SourceTrail</h1>}
          <p className="deck">Ask one question and get a short brief, with a source for every sentence.</p>
        </header>
        {config.paused ? (
          <div className="banner" role="status">
            <p>This site is paused. New questions are not being opened.</p>
          </div>
        ) : null}
        {config.mock ? (
          <div className="banner">
            <p>Demo mode. We are not searching the live web. The sample questions use saved pages, so you can see how a brief looks.</p>
          </div>
        ) : null}
        {!config.configured && !config.paused ? (
          <div className="banner" role="status">
            <p>This server has no model or search key yet. Set NEBIUS_API_KEY and TAVILY_API_KEY, or run with SOURCETRAIL_MOCK=1.</p>
          </div>
        ) : null}
        <form
          className="inquiry"
          onSubmit={(event) => {
            event.preventDefault();
            void fileQuestion(question);
          }}
        >
          <label className="field-label" htmlFor={fieldId}>Your question</label>
          <textarea
            id={fieldId}
            className="question"
            value={question}
            maxLength={config.maxQuestionLength + 40}
            disabled={config.paused}
            placeholder="Ask a question that a public source could answer."
            aria-describedby={`${fieldId}-help`}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <p id={`${fieldId}-help`} className="reassure">We&apos;ll search the web and write a short brief. Every sentence points to a source. If we can&apos;t find one, we&apos;ll say so.</p>
          <div className="inquiry-row">
            {nearLimit ? (
              <p className="count">{remaining >= 0 ? `${remaining} characters left` : `${Math.abs(remaining)} characters over the limit`}</p>
            ) : null}
            <div className="actions">
              {running ? (
                <button type="button" className="ghost" onClick={() => abortRef.current?.abort()}>
                  Stop
                </button>
              ) : null}
              <button className="file" type="submit" disabled={config.paused || running || question.trim().length < 8 || tooLong}>
                {running ? "Searching…" : "Get a brief"}
              </button>
            </div>
          </div>
          <p className="try-label">{outcome === "idle" ? "Try one of these" : "Try another question"}</p>
          <ul className="examples">
            {examples.map((example) => (
              <li key={example.id}>
                <button
                  type="button"
                  className="example"
                  disabled={config.paused || running}
                  onClick={() => void fileQuestion(example.question)}
                >
                  <span className="title">{example.kicker}</span>
                  {outcome === "idle" ? <span className="q">{example.question}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </form>
        <div className={state.brief ? "workspace has-brief" : "workspace"}>
          <Trail state={state} running={running} cap={config.maxCredits} />
          <div className="column" id="brief-column">
            {state.brief ? (
              <BriefView
                brief={state.brief}
                summary={state.summary}
                outcome={outcome}
                activePassageId={sheet?.passageId ?? null}
                onCite={(passageId, claim) => setSheet({ passageId, claim })}
              />
            ) : visibleError ? (
              <section className="failure" role="alert" data-outcome="error">
                <p className="status-line alert">{searchStoppedLabel("en")}</p>
                <h1>We couldn&apos;t finish an answer</h1>
                <p>{visibleError}</p>
                <p className="failure-note">We only show an answer after a source is saved and checked.</p>
              </section>
            ) : running ? (
              <p className="waiting">{trailPhaseLabel(state.plan?.language ?? "en", state.phase === "idle" ? "plan" : state.phase)}</p>
            ) : (
              <section className="method">
                <h2>How it works</h2>
                <ol>
                  <li>We split your question into a few smaller questions, and decide whether a recent source matters.</li>
                  <li>We search each smaller question. If a search comes back empty or weak, we try one rewritten search.</li>
                  <li>We read the strongest pages and keep exact quotes, with the publisher, date, and link.</li>
                  <li>The brief can use only those quotes. If a sentence isn&apos;t backed by a source, we cross it out.</li>
                </ol>
              </section>
            )}
          </div>
        </div>
        <footer className="colophon">
          <p>Built for the ODSC × Nebius hackathon.</p>
          <p>You can ask {config.perHour} questions an hour from this connection, and {config.dailyCap} a day on this site.</p>
          <p>If a sentence isn&apos;t backed by a source, we cross it out. Press / to focus the question.</p>
        </footer>
      </div>
      {passage && sheet ? (
        <SourceSheet
          passage={passage}
          claim={sheet.claim}
          number={noteNumber || 1}
          mock={config.mock || state.mock}
          language={state.brief?.language ?? "en"}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );
}

async function readError(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
      return (data as { message: string }).message;
    }
  } catch {
    /* not JSON */
  }
  return `The server returned status ${response.status}.`;
}

function plainError(message: string): string {
  if (!message) return "";
  return message
    .replaceAll("No brief was filed", "We couldn't finish an answer")
    .replaceAll("lines of inquiry", "smaller questions")
    .replaceAll("The inquiry was stopped", "Search stopped")
    .replaceAll("The inquiry stopped", "Search stopped");
}
