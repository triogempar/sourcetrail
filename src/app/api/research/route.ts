import { runResearch } from "@/lib/agent";
import { getConfig } from "@/lib/env";
import { ConfigError, providerMessage } from "@/lib/errors";
import { checkAndRecord, clientIp, createRateState } from "@/lib/rate-limit";
import { createRuntime } from "@/lib/runtime";
import type { ResearchEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const rates = createRateState();
const BODY_LIMIT = 8000;

export async function POST(request: Request) {
  const config = getConfig();
  if (config.paused) {
    return json(503, "The notebook is paused. New questions are not being opened.");
  }

  const body = await readBody(request);
  if ("error" in body) return json(body.status, body.error);

  const question = body.question.trim();
  if (question.length < 8) {
    return json(400, "Ask a full question, at least a short sentence.");
  }
  if (question.length > config.maxQuestionLength) {
    return json(400, `Questions are limited to ${config.maxQuestionLength} characters.`);
  }

  try {
    createRuntime(question, request.signal, config);
  } catch (error) {
    if (error instanceof ConfigError) return json(500, error.message);
    return json(500, providerMessage(error));
  }

  const decision = checkAndRecord(rates, clientIp(request), Date.now(), {
    perHour: config.perHour,
    dailyCap: config.dailyCap,
  });
  if (!decision.ok) {
    return json(429, decision.message, { retryAfterSec: decision.retryAfterSec, code: decision.code });
  }

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ResearchEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      try {
        const deps = createRuntime(question, request.signal, config);
        await runResearch(question, deps, emit);
      } catch (error) {
        emit({
          type: "error",
          phase: "inquiry",
          message: `${providerMessage(error)} No brief was filed.`,
          fatal: true,
        });
        emit({ type: "done", credits: 0, cap: config.maxCredits, insufficient: false, failed: true });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

async function readBody(request: Request): Promise<{ question: string } | { error: string; status: number }> {
  const lengthHeader = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(lengthHeader) && lengthHeader > BODY_LIMIT) {
    return { error: "The request is too large.", status: 413 };
  }
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return { error: "The request body could not be read.", status: 400 };
  }
  if (raw.length > BODY_LIMIT) return { error: "The request is too large.", status: 413 };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: "Send a JSON object with a question.", status: 400 };
  }
  if (!data || typeof data !== "object" || typeof (data as { question?: unknown }).question !== "string") {
    return { error: "Send a JSON object with a question.", status: 400 };
  }
  return { question: (data as { question: string }).question };
}

function json(status: number, message: string, extra?: Record<string, unknown>) {
  const headers = new Headers();
  if (status === 429 && extra && typeof extra.retryAfterSec === "number") {
    headers.set("Retry-After", String(extra.retryAfterSec));
  }
  return Response.json({ message, ...extra }, { status, headers });
}
