import { scenarioForQuestion, type Scenario } from "@/lib/examples";
import type { RuntimeConfig } from "@/lib/env";
import { ProviderError } from "@/lib/errors";
import { heuristicRewrite } from "@/lib/text";
import type { AgentDeps, DraftBrief, LlmRequest, Plan, SearchHit, SearchRequest } from "@/lib/types";

const RANGE = "A Hamburg pilot of solid-state cells in a midsize passenger car reported a 612 km highway range at a constant 90 km/h, measured by the city's technical university on 28 October 2026.";
const COLD = "The same Hamburg pilot recorded a 9% drop in range at -5°C compared with the 612 km highway figure, in a follow-up run on 30 October 2026.";
const FLEET = "Researchers cautioned that the Hamburg results come from one instrumented vehicle, not a fleet trial.";
const FIRE = "Grid operator notes released that afternoon attributed the 9 September 2026 disturbance to a transformer fire at the Caceres substation.";
const INVERTER = "A separate engineering memo argued the disturbance began with a frequency trip in a cluster of solar inverters in Alentejo, and that the Caceres fire was a consequence rather than the trigger.";
const JOINT = "Neither the Spanish nor the Portuguese regulator had published a joint causal finding by 1 October 2026.";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      reject(error);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function hit(input: {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate: string | null;
  publisher: string;
}): SearchHit {
  return input;
}

function batteryHits(query: string): SearchHit[] {
  const rumor = hit({
    title: "EV rumor roundup",
    url: "https://example.com/sourcetrail/rumor-weekly/ev-gossip",
    content: "An unnamed forum post claimed every new battery doubles range. The post cites no measurement.",
    score: 0.22,
    publishedDate: "2026-10-12",
    publisher: "Rumor Weekly",
  });
  if (/cold|temperature|weather/i.test(query)) {
    return [
      hit({
        title: "Hamburg pilot loses range in the cold",
        url: "https://example.com/sourcetrail/cold-bench/hamburg-cold",
        content: COLD,
        score: 0.9,
        publishedDate: "2026-10-30",
        publisher: "Cold Bench Review",
      }),
      rumor,
    ];
  }
  if (/fleet|trial|size|vehicle/i.test(query)) {
    return [
      hit({
        title: "One car, not a fleet",
        url: "https://example.com/sourcetrail/science-brief/hamburg-fleet",
        content: FLEET,
        score: 0.84,
        publishedDate: "2026-11-01",
        publisher: "North Atlantic Science Brief",
      }),
      rumor,
    ];
  }
  return [
    hit({
      title: "Hamburg solid-state pilot posts a highway figure",
      url: "https://example.com/sourcetrail/harbor-desk/hamburg-range",
      content: RANGE,
      score: 0.93,
      publishedDate: "2026-10-28",
      publisher: "Harbor Desk",
    }),
    rumor,
  ];
}

function gridHits(query: string): SearchHit[] {
  const aside = hit({
    title: "Travelers delayed across the peninsula",
    url: "https://example.com/sourcetrail/platform-notes/delays",
    content: "Trains sat outside Madrid for two hours. The note does not discuss a cause.",
    score: 0.28,
    publishedDate: "2026-09-09",
    publisher: "Platform Notes",
  });
  if (/inverter|alentejo|frequency/i.test(query)) {
    return [
      hit({
        title: "Engineering memo points at Alentejo inverters",
        url: "https://example.com/sourcetrail/peninsula-power/alentejo-memo",
        content: INVERTER,
        score: 0.88,
        publishedDate: "2026-09-18",
        publisher: "Peninsula Power Review",
      }),
      aside,
    ];
  }
  if (/regulator|portuguese|joint/i.test(query)) {
    return [
      hit({
        title: "No joint finding from the two regulators",
        url: "https://example.com/sourcetrail/harbor-desk/joint-finding",
        content: JOINT,
        score: 0.86,
        publishedDate: "2026-10-02",
        publisher: "Harbor Desk",
      }),
      aside,
    ];
  }
  return [
    hit({
      title: "Operator notes name a Caceres transformer fire",
      url: "https://example.com/sourcetrail/iberian-dispatch/caceres-fire",
      content: FIRE,
      score: 0.91,
      publishedDate: "2026-09-12",
      publisher: "Iberian Dispatch",
    }),
    aside,
  ];
}

function planFor(scenario: Scenario, question: string): Plan {
  if (scenario === "batteries") {
    return {
      language: "en",
      recency: true,
      timeRange: "month",
      topic: "news",
      subquestions: [
        {
          id: "sq1",
          question: "What highway range was reported for a solid-state passenger car?",
          query: "Hamburg solid-state passenger car highway range",
          needsRecency: true,
        },
        {
          id: "sq2",
          question: "How did cold weather change the reported range?",
          query: "Hamburg solid-state pilot cold temperature range",
          needsRecency: true,
        },
        {
          id: "sq3",
          question: "How large was the trial?",
          query: "Hamburg solid-state pilot fleet trial size",
          needsRecency: true,
        },
      ],
    };
  }
  if (scenario === "grid") {
    return {
      language: "en",
      recency: false,
      timeRange: null,
      topic: "general",
      subquestions: [
        {
          id: "sq1",
          question: "What did operator notes say caused the disturbance?",
          query: "Caceres substation transformer fire September 2026",
          needsRecency: false,
        },
        {
          id: "sq2",
          question: "Is there a competing engineering account?",
          query: "Alentejo solar inverter frequency trip September 2026",
          needsRecency: false,
        },
        {
          id: "sq3",
          question: "Have the regulators published a joint cause?",
          query: "Spanish Portuguese regulator joint causal finding October 2026",
          needsRecency: false,
        },
      ],
    };
  }
  if (scenario === "northglass") {
    return {
      language: "en",
      recency: true,
      timeRange: "month",
      topic: "news",
      subquestions: [
        {
          id: "sq1",
          question: "Where is the Northglass October 2026 audit score published?",
          query: "Northglass municipality internal audit score October 2026",
          needsRecency: true,
        },
        {
          id: "sq2",
          question: "Did a council paper release the score?",
          query: "Northglass council paper audit October 2026",
          needsRecency: true,
        },
        {
          id: "sq3",
          question: "Did a newsroom report the score?",
          query: "Northglass audit score news October 2026",
          needsRecency: true,
        },
      ],
    };
  }
  if (scenario === "outage") {
    return {
      language: "en",
      recency: true,
      timeRange: "month",
      topic: "news",
      subquestions: [
        {
          id: "sq1",
          question: "Which agencies published casualty figures?",
          query: "Port Meridian flood casualty figures October 2026",
          needsRecency: true,
        },
        {
          id: "sq2",
          question: "What did local officials report?",
          query: "Port Meridian flood official toll October 2026",
          needsRecency: true,
        },
        {
          id: "sq3",
          question: "Did wire services carry a number?",
          query: "Port Meridian flood wire service casualties",
          needsRecency: true,
        },
      ],
    };
  }
  const clipped = question.trim().slice(0, 140);
  return {
    language: "the language of the question",
    recency: /\b(today|this week|latest|yesterday|2026)\b/i.test(question),
    timeRange: /\b(today|yesterday)\b/i.test(question) ? "day" : "month",
    topic: "general",
    subquestions: [
      { id: "sq1", question: clipped, query: clipped, needsRecency: false },
      { id: "sq2", question: `What recent reporting exists on this question?`, query: `${clipped} news`, needsRecency: true },
      { id: "sq3", question: `What primary documents mention this question?`, query: `${clipped} official report`, needsRecency: false },
    ],
  };
}

function passagesInPrompt(user: string): { id: string; text: string }[] {
  return [...user.matchAll(/\[(p\d+)\][^\n]*\n"""([\s\S]*?)"""/g)].map((match) => ({
    id: match[1],
    text: match[2],
  }));
}

function emptyDraft(headline: string, gap: string): DraftBrief {
  return {
    headline,
    insufficient: true,
    lede: [],
    sections: [],
    conflicts: [],
    gaps: [gap],
  };
}

function draftFor(scenario: Scenario, user: string): DraftBrief {
  const passages = passagesInPrompt(user);
  const find = (needle: string) => passages.find((passage) => passage.text.includes(needle))?.id;
  if (scenario === "batteries") {
    const range = find("612 km");
    const cold = find("9%");
    const fleet = find("instrumented vehicle");
    if (!range || !cold || !fleet) return emptyDraft("Fixture passages were incomplete", "The mock writer could not see the recorded passages.");
    return {
      headline: "One Hamburg car posted a 612 km highway range",
      insufficient: false,
      lede: [
        {
          text: "A Hamburg pilot of solid-state cells in a midsize passenger car reported a 612 km highway range at a constant 90 km/h.",
          kind: "fact",
          citations: [range],
        },
        {
          text: "The same Hamburg pilot recorded a 9% drop in range at -5°C compared with the 612 km highway figure.",
          kind: "fact",
          citations: [cold],
        },
        {
          text: "One instrumented vehicle is a thin basis for judging how the cells would behave in a commercial fleet.",
          kind: "inference",
          citations: [fleet],
        },
        {
          text: "The pilots have already cut pack cost by 40 percent.",
          kind: "fact",
          citations: [range],
        },
      ],
      sections: [
        {
          heading: "What the record does not show",
          sentences: [
            {
              text: "Researchers cautioned that the Hamburg results come from one instrumented vehicle, not a fleet trial.",
              kind: "fact",
              citations: [fleet],
            },
          ],
        },
      ],
      conflicts: [],
      gaps: ["No passage reports a production price or a fleet-wide range."],
    };
  }
  if (scenario === "grid") {
    const fire = find("transformer fire");
    const inverter = find("frequency trip");
    const joint = find("joint causal finding");
    if (!fire || !inverter || !joint) return emptyDraft("Fixture passages were incomplete", "The mock writer could not see both accounts.");
    return {
      headline: "Reports do not agree on the Iberian grid trigger",
      insufficient: false,
      lede: [
        {
          text: "Neither the Spanish nor the Portuguese regulator had published a joint causal finding by 1 October 2026.",
          kind: "fact",
          citations: [joint],
        },
        {
          text: "The published accounts name different triggers, so agreement is not established.",
          kind: "inference",
          citations: [fire, inverter],
        },
      ],
      sections: [],
      conflicts: [
        {
          topic: "What triggered the 9 September 2026 disturbance",
          sides: [
            {
              label: "Transformer fire",
              sentences: [{ text: FIRE, kind: "fact", citations: [fire] }],
            },
            {
              label: "Inverter frequency trip",
              sentences: [{ text: INVERTER, kind: "fact", citations: [inverter] }],
            },
          ],
        },
      ],
      gaps: ["No passage quotes a joint report that names one trigger."],
    };
  }
  return emptyDraft("The record does not answer this", "The fixture desk has no passages that answer this question.");
}

function previousQuery(user: string): string {
  return user.match(/Previous query: (.*)/)?.[1]?.trim() ?? "";
}

export function createMockDeps(question: string, config: RuntimeConfig, signal?: AbortSignal): AgentDeps {
  const scenario = scenarioForQuestion(question);
  const pace = config.mockPaceMs;
  return {
    mode: "mock",
    models: config.models,
    maxCredits: config.maxCredits,
    tokens: config.tokens,
    signal,
    llm: {
      async complete(input: LlmRequest): Promise<string> {
        await sleep(pace, input.signal);
        if (input.task === "plan") return JSON.stringify(planFor(scenario, question));
        if (input.task === "rewrite") {
          const previous = previousQuery(input.user);
          if (scenario === "northglass") return JSON.stringify({ query: `${previous} rating`.slice(0, 180) });
          if (scenario === "outage") return JSON.stringify({ query: `${previous} retry`.slice(0, 180) });
          return JSON.stringify({ query: heuristicRewrite(previous, question) });
        }
        if (input.task === "write") return JSON.stringify(draftFor(scenario, input.user));
        const ids = [...input.user.matchAll(/\bid: (s\d+)\b/g)].map((match) => match[1]);
        return JSON.stringify({
          sentences: ids.map((id) => ({ id, verdict: "supported", reason: "simulated pass" })),
        });
      },
    },
    search: {
      async search(input: SearchRequest): Promise<SearchHit[]> {
        await sleep(pace, input.signal);
        if (scenario === "outage") {
          throw new ProviderError("tavily", "timeout", "Tavily timed out before returning results.");
        }
        if (scenario === "unknown") return [];
        if (scenario === "northglass") {
          if (!/rating/i.test(input.query)) return [];
          return [
            hit({
              title: "Visit the Northglass harbor",
              url: "https://example.com/sourcetrail/coastal-gazette/northglass-harbor",
              content: "Northglass is a fictional coastal town used in SourceTrail fixtures. The page describes the harbor and says nothing about an audit.",
              score: 0.22,
              publishedDate: "2024-06-01",
              publisher: "Coastal Gazette",
            }),
          ];
        }
        if (scenario === "grid") return gridHits(input.query);
        return batteryHits(input.query);
      },
      async extract(input) {
        await sleep(pace, input.signal);
        const library: Record<string, string> = {
          "https://example.com/sourcetrail/harbor-desk/hamburg-range": RANGE,
          "https://example.com/sourcetrail/cold-bench/hamburg-cold": COLD,
          "https://example.com/sourcetrail/science-brief/hamburg-fleet": FLEET,
          "https://example.com/sourcetrail/iberian-dispatch/caceres-fire": FIRE,
          "https://example.com/sourcetrail/peninsula-power/alentejo-memo": INVERTER,
          "https://example.com/sourcetrail/harbor-desk/joint-finding": JOINT,
        };
        return {
          documents: input.urls
            .filter((url) => library[url])
            .map((url) => ({ url, rawContent: library[url] })),
          failed: input.urls.filter((url) => !library[url]).map((url) => ({ url, error: "No fixture document" })),
        };
      },
    },
  };
}
