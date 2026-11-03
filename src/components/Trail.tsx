import type { StreamState } from "@/lib/stream-state";
import type { TrailSource } from "@/lib/types";

const DECISION: Record<TrailSource["decision"], string> = {
  kept: "Kept",
  discarded: "Discarded",
  failed: "Failed",
  candidate: "Candidate",
};

export function Trail({
  state,
  running,
  cap,
}: {
  state: StreamState;
  running: boolean;
  cap: number;
}) {
  const status = running && !state.phaseMessage ? "Opening the inquiry" : state.phaseMessage || "Waiting for a question";
  return (
    <aside className="trail" aria-label="Research trail">
      <div className="trail-head">
        <p className="kicker">Research trail</p>
        <p className="phase" role="status" aria-live="polite">{status}</p>
      </div>
      {state.trail.length === 0 ? (
        <p className="trail-empty">The margin stays blank until a question is filed. Lines of inquiry, queries, retries, and discarded pages are recorded here.</p>
      ) : (
        <ol className="trail-list">
          {state.trail.map((entry) => (
            <li key={entry.id} className="trail-item" data-status={entry.status} data-phase={entry.phase}>
              <p className="kicker">{entry.phase}{entry.round ? ` ${entry.round}` : ""}</p>
              <p className="trail-title">{entry.title}</p>
              {entry.query ? <p className="query">{entry.query}</p> : null}
              {entry.detail ? <p className="trail-detail">{entry.detail}</p> : null}
              {entry.sources && entry.sources.length > 0 ? (
                <ul className="trail-sources">
                  {entry.sources.map((source, index) => (
                    <li key={`${entry.id}-${source.url}-${source.decision}-${index}`}>
                      <span className="decision">{DECISION[source.decision]}</span>
                      <span>{source.publisher}</span>
                      <span className="reason">{source.reason}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <p className="credit">Tavily credits budgeted {state.credits} / {state.cap || cap}</p>
    </aside>
  );
}
