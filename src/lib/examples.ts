export const EXAMPLES = [
  {
    id: "batteries",
    kicker: "A recent numbers question",
    question: "What highway range have solid-state battery pilots in passenger cars reported in the last month?",
    dek: "A question about a recent number. The brief should cite the figure, and say what one car cannot prove.",
    scenario: "batteries",
    mockOnly: false,
  },
  {
    id: "grid",
    kicker: "When sources may disagree",
    question: "Do independent reports agree on what triggered the Iberian grid disturbance in September 2026?",
    dek: "Two reports may name different causes. The brief should show both, and not pick a winner.",
    scenario: "grid",
    mockOnly: false,
  },
  {
    id: "northglass",
    kicker: "A question that should have no public answer",
    question: "What score did the municipality of Northglass give its unpublished internal audit in October 2026?",
    dek: "Nothing public should answer this. You should see a gap, not a guessed number.",
    scenario: "northglass",
    mockOnly: false,
  },
  {
    id: "outage",
    kicker: "When the search itself fails",
    question: "Which agencies published casualty figures for the Port Meridian flood in October 2026?",
    dek: "Demo mode pretends the search failed. You should see that we stopped, not a made-up answer.",
    scenario: "outage",
    mockOnly: true,
  },
] as const;

export type Scenario = (typeof EXAMPLES)[number]["scenario"] | "unknown";

export function scenarioForQuestion(question: string): Scenario {
  const match = EXAMPLES.find((example) => example.question === question.trim());
  return match?.scenario ?? "unknown";
}
