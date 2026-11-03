import { describe, expect, it } from "vitest";
import { CreditLedger, extractCreditCost } from "@/lib/credits";

describe("CreditLedger", () => {
  it("holds one credit back for extract", () => {
    const ledger = new CreditLedger(8);
    expect(ledger.trySpend(1, 1)).toBe(true);
    expect(ledger.spent).toBe(1);
    expect(ledger.trySpend(7, 1)).toBe(false);
    expect(ledger.trySpend(1, 0)).toBe(true);
    expect(ledger.spent).toBe(2);
  });

  it("refuses to pass the cap", () => {
    const ledger = new CreditLedger(2);
    expect(ledger.trySpend(2)).toBe(true);
    expect(ledger.trySpend(1)).toBe(false);
    expect(ledger.spent).toBe(2);
  });
});

describe("extractCreditCost", () => {
  it("bills one basic credit per five urls", () => {
    expect(extractCreditCost(0)).toBe(0);
    expect(extractCreditCost(1)).toBe(1);
    expect(extractCreditCost(5)).toBe(1);
    expect(extractCreditCost(6)).toBe(2);
  });
});
