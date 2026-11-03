export type RateState = {
  hits: Map<string, number[]>;
  dayKey: string;
  dayCount: number;
};

export function createRateState(): RateState {
  return { hits: new Map(), dayKey: "", dayCount: 0 };
}

const HOUR_MS = 60 * 60 * 1000;

export type RateDecision =
  | { ok: true }
  | { ok: false; code: "rate" | "daily"; retryAfterSec: number; message: string };

export function checkAndRecord(
  state: RateState,
  ip: string,
  now: number,
  limits: { perHour: number; dailyCap: number },
): RateDecision {
  const dayKey = new Date(now).toISOString().slice(0, 10);
  if (state.dayKey !== dayKey) {
    state.dayKey = dayKey;
    state.dayCount = 0;
  }
  if (state.dayCount >= limits.dailyCap) {
    return {
      ok: false,
      code: "daily",
      retryAfterSec: secondsUntilUtcMidnight(now),
      message: "The notebook has reached its daily question limit. It opens again at 00:00 UTC.",
    };
  }
  const key = ip.trim() || "unknown";
  const recent = (state.hits.get(key) ?? []).filter((stamp) => now - stamp < HOUR_MS);
  if (recent.length >= limits.perHour) {
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((HOUR_MS - (now - oldest)) / 1000));
    state.hits.set(key, recent);
    return {
      ok: false,
      code: "rate",
      retryAfterSec,
      message: `This network has reached ${limits.perHour} inquiries an hour. The next one can open in ${Math.max(1, Math.ceil(retryAfterSec / 60))} min.`,
    };
  }
  recent.push(now);
  state.hits.set(key, recent);
  state.dayCount += 1;
  if (state.hits.size > 2000) {
    for (const [storedKey, stamps] of state.hits) {
      if (stamps.every((stamp) => now - stamp >= HOUR_MS)) state.hits.delete(storedKey);
    }
  }
  return { ok: true };
}

function secondsUntilUtcMidnight(now: number): number {
  const date = new Date(now);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 80);
  }
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 80);
  return "unknown";
}
