"use client";

import { useState } from "react";
import type { StreamState } from "@/lib/stream-state";
import {
  briefLabels,
  searchesUsedLabel,
  searchStoppedLabel,
  trailDecisionLabel,
  trailEmptyLabel,
  trailPhaseLabel,
  trailTitle,
} from "@/lib/text";
import type { Phase, TrailSource } from "@/lib/types";

const STEPS: Phase[] = ["plan", "search", "read", "write", "verify"];

function stepState(step: Phase, current: string): "done" | "current" | "upcoming" {
  if (current === "done") return "done";
  const order = STEPS.indexOf(current as Phase);
  const index = STEPS.indexOf(step);
  if (order < 0) return "upcoming";
  if (index < order) return "done";
  if (index === order) return "current";
  return "upcoming";
}

export function Trail({
  state,
  running,
  cap,
}: {
  state: StreamState;
  running: boolean;
  cap: number;
}) {
  const language = state.plan?.language ?? state.brief?.language ?? "en";
  const failed = state.failed || Boolean(state.error && !state.brief);
  const current = state.phase === "idle" && running ? "plan" : state.phase;
  const status = failed
    ? searchStoppedLabel(language)
    : state.phase === "idle" && !running
      ? ""
      : trailPhaseLabel(language, current);
  const searchStarted = state.credits > 0
    || state.phase === "search"
    || state.phase === "read"
    || state.phase === "write"
    || state.phase === "verify"
    || state.trail.some((entry) => entry.phase === "search" || entry.phase === "read");

  return (
    <aside className="trail" aria-label={trailTitle(language)}>
      <div className="trail-head">
        <h2>{trailTitle(language)}</h2>
        {status ? (
          <p className={running ? "sr-only" : "phase"} role="status" aria-live="polite">{status}</p>
        ) : null}
      </div>
      {running && !failed ? (
        <ol className="progress" aria-label={status || trailTitle(language)}>
          {STEPS.map((step) => {
            const mark = stepState(step, current);
            return (
              <li key={step} data-state={mark} aria-current={mark === "current" ? "step" : undefined}>
                {trailPhaseLabel(language, step)}
              </li>
            );
          })}
        </ol>
      ) : null}
      {searchStarted ? (
        <p className="credit">{searchesUsedLabel(language, state.credits, state.cap || cap)}</p>
      ) : null}
      {state.trail.length === 0 ? (
        running ? null : <p className="trail-empty">{trailEmptyLabel(language)}</p>
      ) : (
        <ol className="trail-list">
          {state.trail.map((entry, index) => {
            const previous = state.trail[index - 1];
            const showPhase = !previous || previous.phase !== entry.phase || previous.round !== entry.round;
            const roundNote = entry.round && entry.round > 1 ? `, round ${entry.round}` : "";
            return (
            <li key={entry.id} className="trail-item" data-status={entry.status} data-phase={entry.phase}>
              {showPhase ? (
                <p className="trail-phase">{trailPhaseLabel(language, entry.phase)}{roundNote}</p>
              ) : null}
              <p className="trail-title">{entry.title}</p>
              {entry.query ? <p className="query">{entry.query}</p> : null}
              {entry.detail ? <p className="trail-detail">{entry.detail}</p> : null}
              {entry.sources && entry.sources.length > 0 ? (
                <SourceList sources={entry.sources} language={language} />
              ) : null}
            </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

function SourceList({ sources, language }: { sources: TrailSource[]; language: string }) {
  const [open, setOpen] = useState(false);
  const labels = briefLabels(language);
  const extra = sources.filter((source) => source.decision === "discarded" || source.decision === "candidate");
  const long = extra.length >= 3;
  const visible = long && !open
    ? sources.filter((source) => source.decision === "kept" || source.decision === "failed")
    : sources;

  return (
    <>
      {visible.length > 0 ? (
        <ul className="trail-sources">
          {visible.map((source, index) => (
            <li key={`${source.url}-${source.decision}-${index}`}>
              <span className="decision">{trailDecisionLabel(language, source.decision)}</span>
              <span>{source.publisher}</span>
              <span className="reason">{source.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {long ? (
        <button type="button" className="show-all" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? labels.showFewer : labels.showAll}
        </button>
      ) : null}
    </>
  );
}
