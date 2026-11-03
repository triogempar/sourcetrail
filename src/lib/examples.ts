export const EXAMPLES = [
  {
    id: "batteries",
    kicker: "This week",
    question: "What highway range have solid-state battery pilots in passenger cars reported in the last month?",
    dek: "Recency matters. The brief should cite measured figures and say what a single car cannot prove.",
    scenario: "batteries",
    mockOnly: false,
  },
  {
    id: "grid",
    kicker: "Two accounts",
    question: "Do independent reports agree on what triggered the Iberian grid disturbance in September 2026?",
    dek: "The notebook should show both triggers and refuse to pick a winner the sources do not share.",
    scenario: "grid",
    mockOnly: false,
  },
  {
    id: "northglass",
    kicker: "Thin record",
    question: "What score did the municipality of Northglass give its unpublished internal audit in October 2026?",
    dek: "A question the public record should not answer. Expect an explicit gap, not a guessed number.",
    scenario: "northglass",
    mockOnly: false,
  },
  {
    id: "outage",
    kicker: "Tool failure",
    question: "Which agencies published casualty figures for the Port Meridian flood in October 2026?",
    dek: "Mock mode simulates a search outage. The desk stops in the open and files no brief.",
    scenario: "outage",
    mockOnly: true,
  },
] as const;

export type Scenario = (typeof EXAMPLES)[number]["scenario"] | "unknown";

export function scenarioForQuestion(question: string): Scenario {
  const match = EXAMPLES.find((example) => example.question === question.trim());
  return match?.scenario ?? "unknown";
}
