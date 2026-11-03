import { describe, expect, it } from "vitest";
import { assessSupport } from "@/lib/entailment";
import { findSupportSpan, heuristicRewrite } from "@/lib/text";

const PASSAGE = "A Hamburg pilot of solid-state cells in a midsize passenger car reported a 612 km highway range at a constant 90 km/h, measured by the city's technical university on 28 October 2026.";

describe("assessSupport", () => {
  it("accepts a sentence grounded in the passage", () => {
    const result = assessSupport(
      "A Hamburg pilot of solid-state cells in a midsize passenger car reported a 612 km highway range at a constant 90 km/h.",
      [PASSAGE],
    );
    expect(result.level).toBe("supported");
  });

  it("rejects a figure the passage does not contain", () => {
    const result = assessSupport("The pilots have already cut pack cost by 40 percent.", [PASSAGE]);
    expect(result.level).toBe("unsupported");
    expect(result.reason).toMatch(/40%/);
  });

  it("rejects a name the passage does not contain", () => {
    const result = assessSupport("A Lisbon pilot reported the same highway range.", [PASSAGE]);
    expect(result.level).toBe("unsupported");
    expect(result.reason).toMatch(/Lisbon/);
  });

  it("flags a partial overlap", () => {
    const result = assessSupport("The Hamburg pilot reported wide public interest after the test.", [PASSAGE]);
    expect(result.level).toBe("partial");
  });
});

describe("findSupportSpan", () => {
  it("highlights the shared clause", () => {
    const span = findSupportSpan(
      "A Hamburg pilot of solid-state cells in a midsize passenger car reported a 612 km highway range at a constant 90 km/h.",
      PASSAGE,
    );
    expect(span).not.toBeNull();
    expect(PASSAGE.slice(span!.start, span!.end).toLowerCase()).toContain("hamburg");
  });
});

describe("heuristicRewrite", () => {
  it("changes the query", () => {
    const next = heuristicRewrite("northglass audit score", "What happened in 2026?");
    expect(next.toLowerCase()).not.toBe("northglass audit score");
    expect(next).toMatch(/2026|report|source|evidence/);
  });
});
