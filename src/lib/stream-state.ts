import type { Brief, Phase, Plan, ResearchEvent, Sentence, TrailEntry, VerificationSummary } from "@/lib/types";

/** Older saved runs stored aside lines as plain strings. */
export function coerceSentences(value: unknown): Sentence[] {
  if (!Array.isArray(value)) return [];
  const sentences: Sentence[] = [];
  value.forEach((item, index) => {
    if (typeof item === "string" && item.trim()) {
      sentences.push({ id: `legacy-${index}`, text: item, kind: "fact", citations: [] });
      return;
    }
    if (!item || typeof item !== "object" || typeof (item as Sentence).text !== "string") return;
    const sentence = item as Sentence;
    sentences.push({
      id: sentence.id || `legacy-${index}`,
      text: sentence.text,
      kind: sentence.kind === "inference" ? "inference" : "fact",
      citations: Array.isArray(sentence.citations) ? sentence.citations : [],
      ...(sentence.flag === "partial" ? { flag: "partial" as const } : {}),
    });
  });
  return sentences;
}

export type StreamState = {
  phase: Phase | "idle";
  phaseMessage: string;
  trail: TrailEntry[];
  plan: Plan | null;
  brief: Brief | null;
  summary: VerificationSummary | null;
  error: string | null;
  credits: number;
  cap: number;
  mock: boolean;
  question: string;
  done: boolean;
  failed: boolean;
};

export function emptyStream(): StreamState {
  return {
    phase: "idle",
    phaseMessage: "",
    trail: [],
    plan: null,
    brief: null,
    summary: null,
    error: null,
    credits: 0,
    cap: 0,
    mock: false,
    question: "",
    done: false,
    failed: false,
  };
}

export function reduceStream(state: StreamState, event: ResearchEvent): StreamState {
  switch (event.type) {
    case "meta":
      return {
        ...emptyStream(),
        phase: "plan",
        phaseMessage: "Opening the inquiry",
        mock: event.mock,
        question: event.question,
        cap: event.maxCredits,
      };
    case "phase":
      return { ...state, phase: event.phase, phaseMessage: event.message };
    case "plan":
      return { ...state, plan: event.plan };
    case "trail": {
      const index = state.trail.findIndex((entry) => entry.id === event.entry.id);
      if (index === -1) return { ...state, trail: [...state.trail, event.entry] };
      const trail = state.trail.slice();
      trail[index] = event.entry;
      return { ...state, trail };
    }
    case "usage":
      return { ...state, credits: event.credits, cap: event.cap };
    case "brief":
      return { ...state, brief: { ...event.brief, aside: coerceSentences(event.brief.aside) } };
    case "verification":
      return { ...state, summary: event.summary };
    case "error":
      return { ...state, error: event.message, failed: event.fatal || state.failed };
    case "done":
      return {
        ...state,
        done: true,
        failed: event.failed,
        credits: event.credits,
        cap: event.cap,
        phase: "done",
        phaseMessage: event.failed ? "Stopped" : "Filed",
      };
    default:
      return state;
  }
}

export type InquiryOutcome = "idle" | "running" | "answered" | "contested" | "insufficient" | "error";

export function inquiryOutcome(state: StreamState, running: boolean): InquiryOutcome {
  if (running && !state.done) return "running";
  if (state.failed || (state.error && !state.brief)) return "error";
  if (!state.brief) return "idle";
  if (state.brief.insufficient) return "insufficient";
  if (state.brief.conflicts.length > 0) return "contested";
  return "answered";
}
