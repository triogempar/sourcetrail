import { describe, expect, it } from "vitest";
import { closeTruncatedJson, completeJson, extractJson } from "@/lib/json";
import { parsePlan, salvageDraft } from "@/lib/schema";
import { naturalizeSentence } from "@/lib/text";
import type { Llm, LlmCompletion } from "@/lib/types";

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

  it("retries a length-cut reply with a higher token budget and can salvage it", async () => {
    const calls: number[] = [];
    const truncated = '{"headline":"Kopi tidak menaikkan risiko hipertensi","insufficient":false,"lede":[{"text":"Studi kohort tidak menemukan kenaikan risiko hipertensi pada orang dewasa.","kind":"fact","citations":["p1"]}],"sections":[{"heading":"Catatan","sentences":[{"text":"Sampel';
    const llm: Llm = {
      async complete(input): Promise<LlmCompletion> {
        calls.push(input.maxTokens);
        if (calls.length === 1) return { content: truncated, finishReason: "length" };
        return { content: "still not json", finishReason: "stop" };
      },
    };
    const draft = await completeJson({
      llm,
      task: "write",
      model: "deepseek-ai/DeepSeek-V4.1-Flash",
      system: "sys",
      user: "Question",
      maxTokens: 3200,
      validate: (data) => {
        if (!data || typeof data !== "object" || !("headline" in data)) throw new Error("no headline");
        return data as { headline: string };
      },
      recover: (text) => {
        const saved = salvageDraft(text);
        return saved ? { headline: saved.headline } : null;
      },
    });
    expect(draft.headline).toMatch(/Kopi tidak/);
    expect(calls[1]).toBeGreaterThan(calls[0] ?? 0);
    expect(closeTruncatedJson(truncated)).toMatchObject({ headline: "Kopi tidak menaikkan risiko hipertensi" });
  });
});

describe("natural attribution", () => {
  it("removes the internal word passage from an Indonesian opener", () => {
    expect(naturalizeSentence("Passage dari Jurnal Kesehatan menyebut bahwa konsumsi kopi tidak menaikkan risiko.")).toBe(
      "Jurnal Kesehatan: konsumsi kopi tidak menaikkan risiko.",
    );
  });
});
