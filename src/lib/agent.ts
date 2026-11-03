import { CreditLedger, extractCreditCost } from "@/lib/credits";
import { isAbort, isTerminalProviderError, providerMessage, SchemaError } from "@/lib/errors";
import { asCompletion, completeJson } from "@/lib/json";
import { buildPassages } from "@/lib/passages";
import { planPrompt, rewritePrompt, verifyPrompt, writePrompt } from "@/lib/prompts";
import { parseDraft, parsePlan, parseRewrite, readVerdicts, salvageDraft, type ModelVerdict } from "@/lib/schema";
import { isUsableHit, isWeak, selectSources } from "@/lib/sources";
import { clip, heuristicRewrite, planFrameTitle, publisherFromUrl, readablePublisher, recencyDetail, uniqueGaps } from "@/lib/text";
import type {
  AgentDeps,
  Brief,
  Passage,
  Plan,
  ResearchEvent,
  SearchHit,
  SubQuestion,
  TrailSource,
  VerificationSummary,
} from "@/lib/types";
import { adjudicate, listWorkingSentences, tagDraft } from "@/lib/verify";

const EXTRACT_HOLD = 1;
const MAX_EXTRACT_URLS = 5;

export type ResearchResult = {
  brief: Brief | null;
  summary: VerificationSummary | null;
  error: string | null;
  credits: number;
};

type SubqResult = {
  sq: SubQuestion;
  queries: string[];
  hits: SearchHit[];
  error: string | null;
};

export async function runResearch(
  question: string,
  deps: AgentDeps,
  emit: (event: ResearchEvent) => void,
): Promise<ResearchResult> {
  const ledger = new CreditLedger(deps.maxCredits);
  const signal = deps.signal;
  const emitUsage = () => emit({ type: "usage", credits: ledger.spent, cap: ledger.cap });
  let activePlan: Plan | null = null;

  emit({
    type: "meta",
    mock: deps.mode === "mock",
    models: deps.models,
    maxCredits: deps.maxCredits,
    question,
  });

  try {
    throwIfAborted(signal);
    emit({ type: "phase", phase: "plan", message: "Breaking the question into lines of inquiry" });
    const planPromptPair = planPrompt(question);
    const plan = await completeJson({
      llm: deps.llm,
      task: "plan",
      model: deps.models.primary,
      system: planPromptPair.system,
      user: planPromptPair.user,
      maxTokens: deps.tokens.plan,
      signal,
      validate: parsePlan,
    });
    activePlan = plan;
    emit({ type: "plan", plan });
    emit({
      type: "trail",
      entry: {
        id: "plan-frame",
        phase: "plan",
        status: "info",
        title: planFrameTitle(plan.language, plan.recency, plan.timeRange),
        detail: `${plan.subquestions.length} lines of inquiry. Language: ${plan.language}.`,
      },
    });
    for (const subquestion of plan.subquestions) {
      emit({
        type: "trail",
        entry: {
          id: `plan-${subquestion.id}`,
          phase: "plan",
          status: "ok",
          title: subquestion.question,
          query: subquestion.query,
          detail: recencyDetail(plan.language, subquestion.needsRecency),
        },
      });
    }

    emit({ type: "phase", phase: "search", message: "Searching each line" });
    const searched = await Promise.all(plan.subquestions.map((subquestion) => searchLine(subquestion)));

    const allFailed = searched.every((result) => result.error && result.hits.length === 0);
    if (allFailed) {
      const message = "Search failed on every line of inquiry. No brief was filed, because there are no passages to cite.";
      emit({ type: "error", phase: "search", message, fatal: true });
      emit({ type: "done", credits: ledger.spent, cap: ledger.cap, insufficient: false, failed: true });
      return { brief: null, summary: null, error: message, credits: ledger.spent };
    }

    emit({ type: "phase", phase: "read", message: "Choosing pages to read" });
    const { kept, discarded } = selectSources(
      searched.map((result) => ({ subquestionId: result.sq.id, hits: result.hits })),
      MAX_EXTRACT_URLS,
    );
    emit({
      type: "trail",
      entry: {
        id: "select",
        phase: "read",
        status: kept.length > 0 ? "ok" : "empty",
        title: kept.length > 0 ? `Chose ${kept.length} page${kept.length === 1 ? "" : "s"} to read` : "No page was strong enough to read",
        detail: `${discarded.length} discarded.`,
        sources: [
          ...kept.map((hit) => sourceRow(hit, "kept", hit.reason)),
          ...discarded.map((hit) => sourceRow(hit, "discarded", hit.reason)),
        ],
      },
    });

    let extracted = null;
    if (kept.length > 0) {
      const cost = extractCreditCost(kept.length);
      if (ledger.trySpend(cost)) {
        emitUsage();
        try {
          extracted = await deps.search.extract({
            urls: kept.map((hit) => hit.url),
            query: question,
            signal,
          });
        } catch (error) {
          if (isAbort(error)) throw error;
          const message = providerMessage(error);
          emit({
            type: "trail",
            entry: {
              id: "extract-error",
              phase: "read",
              status: "error",
              title: "Extract failed",
              detail: `${message} Search snippets will be kept where they exist.`,
            },
          });
        }
      } else {
        emit({
          type: "trail",
          entry: {
            id: "extract-cap",
            phase: "read",
            status: "info",
            title: "Extract skipped to stay inside the credit cap",
            detail: "Search snippets were kept instead of full-page extracts.",
          },
        });
      }
    }

    const { passages, notes } = buildPassages({ kept, extracted, query: question });
    for (const note of notes) {
      emit({
        type: "trail",
        entry: {
          id: `read-${note.url}`,
          phase: "read",
          status: note.status === "failed" ? "error" : "ok",
          title: note.title,
          detail: note.detail,
          sources: [
            {
              title: note.title,
              url: note.url,
              publisher: readablePublisher(publisherFromUrl(note.url)),
              decision: note.status === "failed" ? "failed" : "kept",
              reason: note.detail,
            },
          ],
        },
      });
    }

    const searchedLog = searched.map((result) => ({
      subquestion: result.sq.question,
      queries: result.queries,
    }));
    const searchGaps = searchNotes(searched);

    if (passages.length === 0) {
      const brief = blankBrief(question, plan, searchedLog, searchGaps, deps);
      const summary: VerificationSummary = {
        checked: 0,
        supported: 0,
        flagged: 0,
        dropped: 0,
        inferences: 0,
        droppedSentences: [],
        verifier: "local",
        note: "There was nothing to verify because no citable passage answered the question.",
      };
      emit({
        type: "trail",
        entry: {
          id: "verify-empty",
          phase: "verify",
          status: "empty",
          title: "No passage to check",
          detail: "The brief states the gap instead of guessing.",
        },
      });
      emit({ type: "brief", brief });
      emit({ type: "verification", summary });
      emit({ type: "done", credits: ledger.spent, cap: ledger.cap, insufficient: true, failed: false });
      return { brief, summary, error: null, credits: ledger.spent };
    }

    throwIfAborted(signal);
    emit({ type: "phase", phase: "write", message: "Writing only from the stored passages" });
    emit({
      type: "trail",
      entry: {
        id: "write",
        phase: "write",
        status: "active",
        title: "Drafting from stored passages",
        detail: `${passages.length} passage${passages.length === 1 ? "" : "s"} in front of the writer.`,
      },
    });
    const writePair = writePrompt({ question, language: plan.language, passages });
    const draft = await completeJson({
      llm: deps.llm,
      task: "write",
      model: deps.models.primary,
      system: writePair.system,
      user: writePair.user,
      maxTokens: deps.tokens.write,
      signal,
      validate: parseDraft,
      recover: salvageDraft,
    });
    emit({
      type: "trail",
      entry: {
        id: "write",
        phase: "write",
        status: "ok",
        title: "Draft filed for checking",
        detail: "Citations still have to survive the passage check.",
      },
    });

    const working = tagDraft(draft);
    const facts = listWorkingSentences(working);
    let modelVerdicts = null;
    let modelError: string | null = null;
    emit({ type: "phase", phase: "verify", message: "Checking each sentence against its passage" });
    if (facts.length > 0) {
      const collected: ModelVerdict[] = [];
      const problems: string[] = [];
      const batches: ReturnType<typeof listWorkingSentences>[] = [];
      for (let index = 0; index < facts.length; index += 8) batches.push(facts.slice(index, index + 8));
      const settled = await Promise.all(batches.map(async (batch) => {
        try {
          return await verifyBatch(batch, passages);
        } catch (error) {
          if (isAbort(error) || isTerminalProviderError(error)) throw error;
          problems.push(providerMessage(error));
          return [] as ModelVerdict[];
        }
      }));
      for (const verdicts of settled) collected.push(...verdicts);
      if (collected.length > 0) modelVerdicts = collected;
      else if (problems[0]) {
        modelError = problems[0];
        emit({
          type: "trail",
          entry: {
            id: "verify-model",
            phase: "verify",
            status: "error",
            title: "Second model did not finish",
            detail: `${modelError} Local passage checks still run.`,
          },
        });
      }
    }

    const adjudicated = adjudicate({
      draft: working,
      passages,
      modelVerdicts,
      mode: deps.mode,
      modelError,
      language: plan.language,
      question,
    });
    const gaps = uniqueGaps([...adjudicated.gaps, ...searchGaps]);
    const brief: Brief = {
      question,
      headline: adjudicated.headline,
      language: plan.language,
      insufficient: adjudicated.insufficient,
      lede: adjudicated.lede,
      sections: adjudicated.sections,
      conflicts: adjudicated.conflicts,
      gaps,
      aside: adjudicated.aside,
      searched: searchedLog,
      passages,
      models: { ...deps.models, mode: deps.mode },
    };
    emit({
      type: "trail",
      entry: {
        id: "verify",
        phase: "verify",
        status: adjudicated.summary.dropped > 0 ? "retry" : "ok",
        title: `${adjudicated.summary.supported} supported, ${adjudicated.summary.dropped} struck`,
        detail: adjudicated.summary.note,
      },
    });
    emit({ type: "brief", brief });
    emit({ type: "verification", summary: adjudicated.summary });
    emit({
      type: "done",
      credits: ledger.spent,
      cap: ledger.cap,
      insufficient: brief.insufficient,
      failed: false,
    });
    return { brief, summary: adjudicated.summary, error: null, credits: ledger.spent };
  } catch (error) {
    if (isAbort(error)) {
      return { brief: null, summary: null, error: null, credits: ledger.spent };
    }
    const message = `${providerMessage(error)} No brief was filed.`;
    emit({ type: "error", phase: "inquiry", message, fatal: true });
    emit({ type: "done", credits: ledger.spent, cap: ledger.cap, insufficient: false, failed: true });
    return { brief: null, summary: null, error: message, credits: ledger.spent };
  }

  async function verifyBatch(batch: ReturnType<typeof listWorkingSentences>, sourcePassages: Passage[]): Promise<ModelVerdict[]> {
    const pair = verifyPrompt(batch, sourcePassages, question);
    const maxTokens = Math.min(deps.tokens.verify, 240 + batch.length * 80);
    const ask = (user: string) => deps.llm.complete({
      task: "verify",
      model: deps.models.verify,
      system: pair.system,
      user,
      maxTokens,
      signal,
    });
    const first = asCompletion(await ask(pair.user));
    const parsed = readVerdicts(first.content);
    if (parsed.length > 0) return parsed;
    const second = asCompletion(await ask(`${pair.user}\n\nYour previous reply was truncated or invalid. Reply with one JSON object only. Each reason is at most 8 words.\n\nPrevious reply:\n${clip(first.content, 1200)}`));
    const repaired = readVerdicts(second.content);
    if (repaired.length > 0) return repaired;
    throw new SchemaError("The model returned invalid JSON twice.");
  }

  async function searchLine(sq: SubQuestion): Promise<SubqResult> {
    const queries: string[] = [];
    let hits: SearchHit[] = [];
    let error: string | null = null;
    let query = sq.query;
    for (let round = 1; round <= 2; round += 1) {
      throwIfAborted(signal);
      if (round > 1 && queries.some((previous) => previous.toLowerCase() === query.toLowerCase())) {
        emit({
          type: "trail",
          entry: {
            id: `search-${sq.id}-same`,
            phase: "search",
            status: "info",
            title: sq.question,
            detail: "The rewritten query matched the previous one, so the extra search was skipped.",
            query,
          },
        });
        break;
      }
      if (!ledger.trySpend(1, EXTRACT_HOLD)) {
        emit({
          type: "trail",
          entry: {
            id: `search-${sq.id}-cap`,
            phase: "search",
            status: "error",
            title: sq.question,
            query,
            detail: "Credit cap reached before this search.",
          },
        });
        error = error ?? "Credit cap reached before this search.";
        break;
      }
      emitUsage();
      const entryId = `search-${sq.id}-r${round}`;
      emit({
        type: "trail",
        entry: {
          id: entryId,
          phase: "search",
          status: "active",
          title: sq.question,
          query,
          round,
          detail: round === 1 ? "Search in progress." : "Follow-up search in progress.",
        },
      });
      queries.push(query);
      try {
        const found = await deps.search.search({
          query,
          topic: sq.needsRecency ? "news" : "general",
          timeRange: sq.needsRecency ? (activePlan?.timeRange ?? "month") : null,
          maxResults: 5,
          signal,
        });
        if (hits.length === 0 || !isWeak(found) || strength(found) >= strength(hits)) hits = found;
        error = null;
        const weak = isWeak(found);
        emit({
          type: "trail",
          entry: {
            id: entryId,
            phase: "search",
            status: weak ? (round < 2 ? "retry" : "empty") : "ok",
            title: sq.question,
            query,
            round,
            detail: describeHits(found, weak, round),
            sources: found.map((item) => sourceRow(
              item,
              isUsableHit(item) ? "candidate" : "discarded",
              isUsableHit(item) ? "Candidate" : "Weak match",
            )),
          },
        });
        if (!weak || round === 2) break;
        if (ledger.remaining(EXTRACT_HOLD) < 1) break;
        query = await rewrite(sq, query, "The results were empty or weak.");
      } catch (caught) {
        if (isAbort(caught) || isTerminalProviderError(caught)) throw caught;
        error = providerMessage(caught);
        emit({
          type: "trail",
          entry: {
            id: entryId,
            phase: "search",
            status: "error",
            title: sq.question,
            query,
            round,
            detail: error,
          },
        });
        if (round === 2 || ledger.remaining(EXTRACT_HOLD) < 1) break;
        query = await rewrite(sq, query, error);
      }
    }
    return { sq, queries, hits, error };
  }

  async function rewrite(sq: SubQuestion, previous: string, problem: string): Promise<string> {
    try {
      const pair = rewritePrompt({ question, subquestion: sq.question, previous, problem });
      const rewritten = await completeJson({
        llm: deps.llm,
        task: "rewrite",
        model: deps.models.primary,
        system: pair.system,
        user: pair.user,
        maxTokens: deps.tokens.rewrite,
        signal,
        validate: parseRewrite,
      });
      if (rewritten.query.toLowerCase() !== previous.toLowerCase()) return rewritten.query;
    } catch (error) {
      if (isAbort(error)) throw error;
    }
    return heuristicRewrite(previous, question);
  }
}

function strength(hits: SearchHit[]): number {
  if (hits.length === 0) return 0;
  const best = Math.max(...hits.map((hit) => hit.score));
  const usable = hits.filter(isUsableHit).length;
  return best + usable * 0.05;
}

function describeHits(hits: SearchHit[], weak: boolean, round: number): string {
  if (hits.length === 0) return round < 2 ? "No results. The query will be rewritten." : "No results after the follow-up search.";
  if (weak) return round < 2 ? "Only weak matches. The query will be rewritten." : "Follow-up search still looks weak.";
  const usable = hits.filter(isUsableHit).length;
  return `${hits.length} results, ${usable} strong enough to consider.`;
}

function sourceRow(hit: SearchHit, decision: TrailSource["decision"], reason: string): TrailSource {
  return {
    title: hit.title,
    url: hit.url,
    publisher: hit.publisher || publisherFromUrl(hit.url),
    decision,
    reason,
  };
}

function searchNotes(results: SubqResult[]): string[] {
  const notes: string[] = [];
  const skipped = results.filter((result) => result.queries.length === 0).length;
  const failed = results.filter((result) => result.error && result.hits.length === 0);
  const weak = results.filter((result) => result.queries.length > 0 && isWeak(result.hits) && !(result.error && result.hits.length === 0));
  if (skipped > 0) {
    notes.push(`${skipped} ${skipped === 1 ? "line was" : "lines were"} not searched because the credit cap was reached.`);
  }
  if (failed.length > 0) {
    notes.push(`${failed.length} ${failed.length === 1 ? "line" : "lines"} of inquiry failed: ${failed[0]?.error ?? "the search failed"}.`);
  }
  if (weak.length > 0) {
    notes.push(`${weak.length} ${weak.length === 1 ? "line" : "lines"} of inquiry returned no strong page.`);
  }
  return notes;
}

function blankBrief(
  question: string,
  plan: Plan,
  searched: { subquestion: string; queries: string[] }[],
  gaps: string[],
  deps: AgentDeps,
): Brief {
  return {
    question,
    headline: "The searched pages do not answer this",
    language: plan.language,
    insufficient: true,
    lede: [],
    sections: [],
    conflicts: [],
    gaps: gaps.length > 0 ? gaps : ["No retrieved passage states an answer to the question."],
    aside: [],
    searched,
    passages: [],
    models: { ...deps.models, mode: deps.mode },
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    throw error;
  }
}
