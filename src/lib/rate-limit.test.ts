import { describe, expect, it } from "vitest";
import { checkAndRecord, createRateState } from "@/lib/rate-limit";

describe("checkAndRecord", () => {
  it("allows six inquiries an hour and blocks the seventh", () => {
    const state = createRateState();
    const now = Date.parse("2026-11-03T12:00:00Z");
    for (let i = 0; i < 6; i += 1) {
      expect(checkAndRecord(state, "203.0.113.4", now + i, { perHour: 6, dailyCap: 24 }).ok).toBe(true);
    }
    const blocked = checkAndRecord(state, "203.0.113.4", now + 10, { perHour: 6, dailyCap: 24 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("rate");
    expect(checkAndRecord(state, "203.0.113.9", now + 10, { perHour: 6, dailyCap: 24 }).ok).toBe(true);
  });

  it("resets the daily counter on the next UTC day", () => {
    const state = createRateState();
    const first = Date.parse("2026-11-03T23:00:00Z");
    expect(checkAndRecord(state, "a", first, { perHour: 6, dailyCap: 1 }).ok).toBe(true);
    const blocked = checkAndRecord(state, "b", first + 1000, { perHour: 6, dailyCap: 1 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("daily");
    const nextDay = Date.parse("2026-11-04T00:10:00Z");
    expect(checkAndRecord(state, "b", nextDay, { perHour: 6, dailyCap: 1 }).ok).toBe(true);
  });
});
