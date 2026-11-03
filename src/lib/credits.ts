export class CreditLedger {
  spent = 0;

  constructor(readonly cap: number) {}

  remaining(hold = 0): number {
    return Math.max(0, this.cap - this.spent - hold);
  }

  trySpend(amount: number, hold = 0): boolean {
    if (amount <= 0) return true;
    if (this.spent + amount > this.cap - hold) return false;
    this.spent += amount;
    return true;
  }
}

/** Basic extract bills 1 credit per 5 successful URLs. Reserve the worst case. */
export function extractCreditCost(urlCount: number): number {
  if (urlCount <= 0) return 0;
  return Math.ceil(urlCount / 5);
}
