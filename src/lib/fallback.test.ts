import { afterEach, describe, expect, it, vi } from "vitest";
import { NebiusClient } from "@/lib/nebius";
import type { LlmRequest } from "@/lib/types";

const PRIMARY = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const VERIFY = "Qwen/Qwen3-30B-A3B-Instruct-2507";
const MINIMAX = "MiniMaxAI/MiniMax-M3";
const GLM = "zai-org/GLM-5.3-Flash";

type ChatBody = {
  model: string;
  messages: { role: string; content: string }[];
  max_tokens: number;
  temperature: number;
};

function client(): NebiusClient {
  return new NebiusClient({
    apiKey: "test-key",
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
    timeoutMs: 5_000,
    models: { primary: PRIMARY, verify: VERIFY },
  });
}

function request(task: LlmRequest["task"], model: string): LlmRequest {
  return {
    task,
    model,
    system: "Stay with the passages.",
    user: "What range was reported?",
    maxTokens: 700,
  };
}

function completion(text: string): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: text }, finish_reason: "stop" }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function errorResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({
    error: { message: code, code },
  }), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Nebius model fallback", () => {
  it("falls back to MiniMax-M3 when the primary returns 404 and skips it later", async () => {
    const bodies: ChatBody[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as ChatBody;
      bodies.push(body);
      if (body.model === PRIMARY) return errorResponse(404, "model_not_found");
      return completion("{\"ok\":true}");
    });

    const llm = client();
    const first = await llm.complete(request("plan", PRIMARY));
    expect(first.model).toBe(MINIMAX);
    expect(first.content).toBe("{\"ok\":true}");
    expect(bodies.map((body) => body.model)).toEqual([PRIMARY, MINIMAX]);
    expect(bodies[1]?.messages).toEqual(bodies[0]?.messages);
    expect(bodies[1]?.max_tokens).toBe(bodies[0]?.max_tokens);

    const second = await llm.complete(request("write", PRIMARY));
    expect(second.model).toBe(MINIMAX);
    expect(bodies.map((body) => body.model)).toEqual([PRIMARY, MINIMAX, MINIMAX]);
    expect(llm.answeredModels()).toEqual({ primary: MINIMAX, verify: VERIFY });
  });

  it("falls back to GLM-5.3-Flash when the verifier returns 429", async () => {
    const models: string[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as ChatBody;
      models.push(body.model);
      if (body.model === VERIFY) return errorResponse(429, "rate_limit_exceeded");
      return completion("{\"sentences\":[]}");
    });

    const llm = client();
    const result = await llm.complete(request("verify", VERIFY));
    expect(models).toEqual([VERIFY, GLM]);
    expect(result.model).toBe(GLM);
    expect(llm.answeredModels().verify).toBe(GLM);
  });

  it("does not fall back when Nebius rejects the key", async () => {
    const models: string[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as ChatBody;
      models.push(body.model);
      return errorResponse(401, "invalid_api_key");
    });

    const llm = client();
    await expect(llm.complete(request("plan", PRIMARY))).rejects.toMatchObject({
      provider: "nebius",
      status: 401,
    });
    expect(models).toEqual([PRIMARY]);
    expect(llm.answeredModels().primary).toBe(PRIMARY);
  });
});
