import { describe, expect, it } from "vitest";
import { DEFAULT_NEBIUS_TIMEOUT_MS, DEFAULT_VERIFY_TOKENS } from "@/lib/env";
import {
  buildChatCompletionBody,
  modelThinksByDefault,
  readReasoningTokens,
  timeoutForTask,
} from "@/lib/nebius";
import { isBoilerplate } from "@/lib/passages";
import { parseDraft, readVerdicts, salvageVerdicts } from "@/lib/schema";

describe("thinking-default models", () => {
  it("disables thinking for DeepSeek V4 and Qwen3", () => {
    expect(modelThinksByDefault("deepseek-ai/DeepSeek-V4.1-Flash")).toBe(true);
    expect(modelThinksByDefault("Qwen/Qwen3-235B-A22B-Instruct-2507")).toBe(true);
    expect(modelThinksByDefault("openai/gpt-oss-120b")).toBe(false);
    const body = buildChatCompletionBody({
      model: "deepseek-ai/DeepSeek-V4.1-Flash",
      system: "sys",
      user: "user",
      maxTokens: 1600,
      temperature: 0.2,
    });
    expect(body.chat_template_kwargs).toEqual({ thinking: false });
    expect(body.max_tokens).toBe(1600);
    expect(buildChatCompletionBody({
      model: "openai/gpt-oss-120b",
      system: "sys",
      user: "user",
      maxTokens: 100,
      temperature: 0.1,
    }).chat_template_kwargs).toBeUndefined();
  });

  it("keeps write calls inside a 40s default and the Hobby function budget", () => {
    expect(DEFAULT_NEBIUS_TIMEOUT_MS).toBe(40_000);
    expect(timeoutForTask("write", DEFAULT_NEBIUS_TIMEOUT_MS)).toBe(40_000);
    expect(timeoutForTask("verify", DEFAULT_NEBIUS_TIMEOUT_MS)).toBe(40_000);
    expect(timeoutForTask("plan", DEFAULT_NEBIUS_TIMEOUT_MS)).toBe(30_000);
    expect(timeoutForTask("rewrite", DEFAULT_NEBIUS_TIMEOUT_MS)).toBe(20_000);
    const worstCase = 30_000 + 14_000 + 20_000 + 14_000 + 18_000 + 40_000 + 40_000;
    expect(worstCase).toBeLessThanOrEqual(180_000);
  });

  it("names an empty completion that was spent on reasoning", () => {
    expect(readReasoningTokens({
      choices: [{ message: { content: "", reasoning_content: "thinking out loud" } }],
      usage: { completion_tokens_details: { reasoning_tokens: 1600 } },
    })).toBe(1600);
  });
});

describe("verifier budget", () => {
  it("allows a 16 to 20 sentence check to finish", () => {
    expect(DEFAULT_VERIFY_TOKENS).toBeGreaterThanOrEqual(1400);
  });

  it("salvages verdicts from a reply cut off at the token limit", () => {
    const truncated = '{"sentences":[{"id":"s1","verdict":"supported","reason":"matches"},{"id":"s2","verdict":"unsupported","reason":"no figure"},{"id":"s3","verdict":"partial"';
    const salvaged = salvageVerdicts(truncated);
    expect(salvaged.map((verdict) => verdict.id)).toEqual(["s1", "s2"]);
    expect(readVerdicts(truncated).map((verdict) => verdict.verdict)).toEqual(["supported", "unsupported"]);
  });
});

describe("headline and boilerplate", () => {
  it("strips a truncated headline ellipsis", () => {
    const draft = parseDraft({
      headline: "Studi kopi dan hipertensi menemukan hasil yang terbelah…",
      insufficient: true,
      lede: [],
      gaps: ["Belum ada angka.", "Belum ada angka.", "belum ada angka"],
    });
    expect(draft.headline.endsWith("…")).toBe(false);
    expect(draft.headline.endsWith("...")).toBe(false);
    expect(draft.gaps).toHaveLength(1);
  });

  it("drops a paywall passage", () => {
    expect(isBoilerplate("Subscribe to continue reading. Already a subscriber? Sign in to continue. This article is for subscribers.")).toBe(true);
    expect(isBoilerplate("A Hamburg pilot of solid-state cells reported a 612 km highway range at a constant 90 km/h.")).toBe(false);
  });
});