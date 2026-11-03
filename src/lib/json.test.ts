import { describe, expect, it } from "vitest";
import { completeJson, extractJson } from "@/lib/json";
import { parsePlan } from "@/lib/schema";
import type { Llm } from "@/lib/types";

describe("extractJson", () => {
  it("reads a fenced object and repairs a trailing comma", () => {
    const value = extractJson("```json\n{\"recency\": true,}\n```");
    expect(value).toEqual({ recency: true });
  });

  it("rejects prose with no object", () => {
    expect(() => extractJson("no json here")).toThrow(/No JSON object/);
  });
});

describe("completeJson", () => {
  it("validates the first reply when it is usable", async () => {
    const calls: string[] = [];
    const llm: Llm = {
      async complete(input) {
        calls.push(input.user);
        return "{\"language\":\"en\",\"recency\":false,\"topic\":\"general\",\"subquestions\":[{\"id\":\"sq1\",\"question\":\"What is the range reported?\",\"query\":\"range report\"},{\"id\":\"sq2\",\"question\":\"Who measured the range?\",\"query\":\"range measurement\"},{\"id\":\"sq3\",\"question\":\"How large was the trial?\",\"query\":\"trial size\"}]}";
      },
    };
    const plan = await completeJson({
      llm,
      task: "plan",
      model: "test",
      system: "sys",
      user: "Question",
      maxTokens: 200,
      validate: parsePlan,
    });
    expect(plan.subquestions).toHaveLength(3);
    expect(calls).toHaveLength(1);
  });

  it("retries once and then fails closed", async () => {
    let n = 0;
    const llm: Llm = {
      async complete() {
        n += 1;
        return n === 1 ? "{\"nope\":true}" : "still not a plan";
      },
    };
    await expect(completeJson({
      llm,
      task: "plan",
      model: "test",
      system: "sys",
      user: "Question",
      maxTokens: 200,
      validate: parsePlan,
    })).rejects.toThrow(/invalid JSON twice/);
    expect(n).toBe(2);
  });
});
