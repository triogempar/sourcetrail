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
        setHttpError("The desk returned an empty stream.");
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
            error: "The connection closed before a verified brief was filed.",
            failed: true,
            done: true,
            phase: "done",
            phaseMessage: "Stopped",
          };
        }
        return current;
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setState((current) => current.brief ? current : {
          ...current,
          error: "The inquiry was stopped before a brief was filed.",
          failed: true,
          done: true,
          phase: "done",
          phaseMessage: "Stopped",
        });
        return;
      }
      setHttpError(error instanceof Error ? error.message : "The inquiry stopped.");
    } finally {
      setRunning(false);
    }
  }

  const visibleError = httpError || state.error;
  const outcome = httpError ? "error" : inquiryOutcome(state, running);
  const examples = EXAMPLES.filter((example) => config.mock || !example.mockOnly);
  const passage = state.brief?.passages.find((item) => item.id === sheet?.passageId) ?? null;
  const noteNumber = state.brief && sheet ? footnoteNumber(citationOrder(state.brief), sheet.passageId) : 0;
  const tooLong = question.length > config.maxQuestionLength;

  return (
    <>
      <a className="skip" href="#brief-column">Skip to the brief</a>
      <div className="page">
        <header className="nameplate">
          <p className="issue"><span>ODSC × Nebius</span><span>No. 01</span></p>
          {state.brief ? <p className="wordmark">SourceTrail</p> : <h1 className="wordmark">SourceTrail</h1>}
          <hr className="rule-double" />
          <p className="deck">One question goes in. A short brief comes out, and every factual sentence has to point at a passage that actually says it.</p>
        </header>
        {config.paused ? (
          <div className="banner" role="status">
            <p>The notebook is paused. New questions are not being opened.</p>
          </div>
        ) : null}
        {config.mock ? (
          <div className="banner">
            <p>Fixture desk. Nebius and Tavily are not called. Passages on the sample inquiries are recorded fixtures, not live web results.</p>
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
          <label className="inquiry-label kicker" htmlFor={fieldId}>The question</label>
          <textarea
            id={fieldId}
            className="question"
            value={question}
            maxLength={config.maxQuestionLength + 40}
            disabled={config.paused}
            placeholder="Ask something a source can answer."
            onChange={(event) => setQuestion(event.target.value)}
          />
          <div className="inquiry-row">
            <p className="count">{Math.max(0, config.maxQuestionLength - question.length)} characters left</p>
            <div className="actions">
              {running ? (
                <button type="button" className="ghost" onClick={() => abortRef.current?.abort()}>
                  Stop
                </button>
              ) : null}
              <button className="file" type="submit" disabled={config.paused || running || question.trim().length < 8 || tooLong}>
                {running ? "Inquiry in progress" : "File the question"}
              </button>
            </div>
          </div>
          {outcome === "idle" ? (
            <ul className="examples">
              {examples.map((example) => (
                <li key={example.id}>
                  <button
                    type="button"
                    className="example"
                    disabled={config.paused || running}
                    onClick={() => void fileQuestion(example.question)}
                  >
                    <span className="kicker">{example.kicker}</span>
                    <span className="q">{example.question}</span>
                    <span className="dek">{example.dek}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="example-row">
              <p className="kicker">Other inquiries</p>
              {examples.map((example) => (
                <button
                  key={example.id}
                  type="button"
                  className="text-button"
                  disabled={config.paused || running}
                  onClick={() => void fileQuestion(example.question)}
                >
                  {example.kicker}
                </button>
              ))}
            </div>
          )}
        </form>
        <div className="workspace">
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
                <p className="kicker">Inquiry stopped</p>
                <h1>No brief was filed</h1>
                <p>{visibleError}</p>
                <p>A brief is filed only after a passage is stored and checked.</p>
              </section>
            ) : running ? (
              <p className="waiting">{state.phaseMessage || "Opening the inquiry"}</p>
            ) : (
              <section className="method">
                <p className="kicker">How a page gets filed</p>
                <ol>
                  <li>The question is split into a few lines of inquiry, and the desk decides whether recency matters.</li>
                  <li>Each line is searched. An empty or weak page gets one rewritten query, inside a hard credit cap.</li>
                  <li>The strongest pages are read. Verbatim passages are kept with their publisher, date, and URL.</li>
                  <li>The brief may use only those passages. A second pass strikes any sentence they do not support.</li>
                </ol>
              </section>
            )}
          </div>
        </div>
        <footer className="colophon">
          <p>
            {config.perHour} inquiries an hour from one network. {config.dailyCap} a day across the desk.
            At most {config.maxCredits} Tavily credits a question. Claims without a supporting passage are struck.
          </p>
          <p>Press / to focus the question.</p>
        </footer>
      </div>
      {passage && sheet ? (
        <SourceSheet
          passage={passage}
          claim={sheet.claim}
          number={noteNumber || 1}
          mock={config.mock || state.mock}
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
  return `The desk returned status ${response.status}.`;
}
