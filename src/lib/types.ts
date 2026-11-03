export type TimeRange = "day" | "week" | "month" | "year";

export type SubQuestion = {
  id: string;
  question: string;
  query: string;
  needsRecency: boolean;
};

export type Plan = {
  language: string;
  recency: boolean;
  timeRange: TimeRange | null;
  topic: "news" | "general";
  subquestions: SubQuestion[];
};

export type SearchHit = {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate: string | null;
  publisher?: string;
};

export type ExtractDocument = {
  url: string;
  rawContent: string;
};

export type ExtractFailure = {
  url: string;
  error: string;
};

export type ExtractResult = {
  documents: ExtractDocument[];
  failed: ExtractFailure[];
};

export type LlmTask = "plan" | "rewrite" | "write" | "verify";

export type LlmRequest = {
  task: LlmTask;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type LlmCompletion = {
  content: string;
  finishReason: string | null;
};

export type Llm = {
  complete(input: LlmRequest): Promise<string | LlmCompletion>;
};

export type SearchRequest = {
  query: string;
  topic: "news" | "general";
  timeRange: TimeRange | null;
  maxResults: number;
  signal?: AbortSignal;
};

export type ExtractRequest = {
  urls: string[];
  query: string;
  signal?: AbortSignal;
};

export type SearchClient = {
  search(input: SearchRequest): Promise<SearchHit[]>;
  extract(input: ExtractRequest): Promise<ExtractResult>;
};

export type Passage = {
  id: string;
  url: string;
  title: string;
  publisher: string;
  publishedDate: string | null;
  text: string;
  origin: "extract" | "snippet";
};

export type DraftSentence = {
  text: string;
  kind: "fact" | "inference";
  citations: string[];
};

export type DraftBrief = {
  headline: string;
  insufficient: boolean;
  lede: DraftSentence[];
  sections: { heading: string; sentences: DraftSentence[] }[];
  conflicts: { topic: string; sides: { label: string; sentences: DraftSentence[] }[] }[];
  gaps: string[];
};

export type Sentence = {
  id: string;
  text: string;
  kind: "fact" | "inference";
  citations: string[];
  flag?: "partial";
};

export type Brief = {
  question: string;
  headline: string;
  language: string;
  insufficient: boolean;
  lede: Sentence[];
  sections: { heading: string; sentences: Sentence[] }[];
  conflicts: { topic: string; sides: { label: string; sentences: Sentence[] }[] }[];
  gaps: string[];
  aside: string[];
  searched: { subquestion: string; queries: string[] }[];
  passages: Passage[];
  models: { primary: string; verify: string; mode: "live" | "mock" };
};

export type VerificationSummary = {
  checked: number;
  supported: number;
  flagged: number;
  dropped: number;
  inferences: number;
  droppedSentences: { text: string; reason: string }[];
  verifier: "model+local" | "local";
  note: string;
};

export type Phase = "plan" | "search" | "read" | "write" | "verify" | "done";

export type TrailSource = {
  title: string;
  url: string;
  publisher: string;
  decision: "kept" | "discarded" | "failed" | "candidate";
  reason: string;
};

export type TrailEntry = {
  id: string;
  phase: Phase | "gap";
  status: "active" | "ok" | "retry" | "empty" | "error" | "info";
  title: string;
  detail?: string;
  query?: string;
  round?: number;
  sources?: TrailSource[];
};

export type ResearchEvent =
  | {
      type: "meta";
      mock: boolean;
      models: { primary: string; verify: string };
      maxCredits: number;
      question: string;
    }
  | { type: "phase"; phase: Phase; message: string }
  | { type: "plan"; plan: Plan }
  | { type: "trail"; entry: TrailEntry }
  | { type: "usage"; credits: number; cap: number }
  | { type: "brief"; brief: Brief }
  | { type: "verification"; summary: VerificationSummary }
  | { type: "error"; phase: string; message: string; fatal: boolean }
  | { type: "done"; credits: number; cap: number; insufficient: boolean; failed: boolean };

export type AgentDeps = {
  mode: "live" | "mock";
  llm: Llm;
  search: SearchClient;
  models: { primary: string; verify: string };
  maxCredits: number;
  tokens: { plan: number; rewrite: number; write: number; verify: number };
  signal?: AbortSignal;
};
