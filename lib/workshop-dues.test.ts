import { describe, it, expect } from "vitest";
import {
  computeDueDisplayStatus,
  computeDueBalance,
  computeDueSummary,
  formatPeriodLabel,
  lastPaidPeriod,
  previousPeriod,
  nextPeriod,
} from "./workshop-dues";

describe("previousPeriod / nextPeriod", () => {
  it("steps within a year", () => {
    expect(nextPeriod("2026-09")).toBe("2026-10");
    expect(previousPeriod("2026-09")).toBe("2026-08");
  });

  it("crosses a year boundary correctly", () => {
    expect(nextPeriod("2026-12")).toBe("2027-01");
    expect(previousPeriod("2026-01")).toBe("2025-12");
  });
});

describe("computeDueDisplayStatus", () => {
  it("never treats 'no payments yet' as anything but pending — not paid, not a crash", () => {
    expect(computeDueDisplayStatus("pending", 50000, 0)).toBe("pending");
  });

  it("is partial once some but not all of the amount is paid", () => {
    expect(computeDueDisplayStatus("pending", 50000, 20000)).toBe("partial");
  });

  it("is paid once the paid amount reaches the full amount", () => {
    expect(computeDueDisplayStatus("pending", 50000, 50000)).toBe("paid");
  });

  it("is paid even if slightly overpaid, never a 5th state", () => {
    expect(computeDueDisplayStatus("pending", 50000, 50001)).toBe("paid");
  });

  it("cancelled wins regardless of any payment sum", () => {
    expect(computeDueDisplayStatus("cancelled", 50000, 50000)).toBe("cancelled");
  });
});

describe("computeDueBalance", () => {
  it("never goes negative on an overpayment", () => {
    expect(computeDueBalance(50000, 60000)).toBe(0);
  });

  it("is the full amount when nothing's paid", () => {
    expect(computeDueBalance(50000, 0)).toBe(50000);
  });
});

// The brief's own worked example (sección 62): 2 cuotas de $50.000 →
// facturación $100.000, cobrado $0, pendiente $100.000; después de pagar
// una → facturación $100.000, cobrado $50.000, pendiente $50.000.
describe("facturación vs cobranza (sección 62)", () => {
  it("billed is always the sum of amounts, regardless of what's been paid", () => {
    const dues = [
      { amount: 50000, paidAmount: 0 },
      { amount: 50000, paidAmount: 0 },
    ];
    const billed = dues.reduce((sum, d) => sum + d.amount, 0);
    const collected = dues.reduce((sum, d) => sum + d.paidAmount, 0);
    expect(billed).toBe(100000);
    expect(collected).toBe(0);
    expect(billed - collected).toBe(100000);
  });

  it("collecting one due doesn't change billed, only collected and pending", () => {
    const dues = [
      { amount: 50000, paidAmount: 50000 }, // this one got paid
      { amount: 50000, paidAmount: 0 },
    ];
    const billed = dues.reduce((sum, d) => sum + d.amount, 0);
    const collected = dues.reduce((sum, d) => sum + d.paidAmount, 0);
    expect(billed).toBe(100000);
    expect(collected).toBe(50000);
    expect(billed - collected).toBe(50000);
  });
});

describe("computeDueSummary", () => {
  it("with no extras, behaves exactly like the base amount alone", () => {
    const summary = computeDueSummary({ status: "pending", amount: 50000 }, [], [{ amount: 20000 }]);
    expect(summary).toEqual({
      baseAmount: 50000,
      extrasTotal: 0,
      totalDue: 50000,
      paidTotal: 20000,
      balance: 30000,
      status: "partial",
    });
  });

  it("extras add to what's owed, never inserted as a payment", () => {
    const items = [{ amount: 8500, voided_at: null }, { amount: 1500, voided_at: null }];
    const summary = computeDueSummary({ status: "pending", amount: 50000 }, items, []);
    expect(summary.extrasTotal).toBe(10000);
    expect(summary.totalDue).toBe(60000);
    expect(summary.status).toBe("pending"); // nothing paid yet
  });

  it("a voided extra is excluded from the total", () => {
    const items = [
      { amount: 8500, voided_at: null },
      { amount: 1500, voided_at: "2026-09-10T12:00:00Z" }, // anulado
    ];
    const summary = computeDueSummary({ status: "pending", amount: 50000 }, items, []);
    expect(summary.extrasTotal).toBe(8500);
    expect(summary.totalDue).toBe(58500);
  });

  it("a due already fully paid drops back to partial once a new extra is added — no special case needed, the status is always derived", () => {
    const paidInFull = computeDueSummary({ status: "pending", amount: 50000 }, [], [{ amount: 50000 }]);
    expect(paidInFull.status).toBe("paid");

    const withNewExtra = computeDueSummary(
      { status: "pending", amount: 50000 },
      [{ amount: 8500, voided_at: null }],
      [{ amount: 50000 }] // same payments as before, nothing new paid
    );
    expect(withNewExtra.status).toBe("partial");
    expect(withNewExtra.balance).toBe(8500);
  });

  it("cancelled status wins regardless of extras or payments", () => {
    const summary = computeDueSummary(
      { status: "cancelled", amount: 50000 },
      [{ amount: 8500, voided_at: null }],
      [{ amount: 58500 }]
    );
    expect(summary.status).toBe("cancelled");
  });
});

describe("formatPeriodLabel", () => {
  it("formats AAAA-MM as a human month/year", () => {
    expect(formatPeriodLabel("2026-09")).toBe("Septiembre 2026");
  });

  it("returns the raw string unchanged if it isn't AAAA-MM", () => {
    expect(formatPeriodLabel("garbage")).toBe("garbage");
  });
});

describe("lastPaidPeriod", () => {
  it("picks the most recent period that's actually paid, ignoring pending/cancelled ones", () => {
    const dues = [
      { period: "2026-06", status: "pending" as const, amount: 100, paidAmount: 100 },
      { period: "2026-08", status: "pending" as const, amount: 100, paidAmount: 100 },
      { period: "2026-09", status: "pending" as const, amount: 100, paidAmount: 0 }, // still owed
    ];
    expect(lastPaidPeriod(dues)).toBe("2026-08");
  });

  it("returns null when nothing has ever been paid, instead of guessing", () => {
    const dues = [{ period: "2026-09", status: "pending" as const, amount: 100, paidAmount: 0 }];
    expect(lastPaidPeriod(dues)).toBeNull();
  });

  it("a cancelled due is never counted as paid even if it happens to have payments recorded before cancellation", () => {
    const dues = [{ period: "2026-09", status: "cancelled" as const, amount: 100, paidAmount: 100 }];
    expect(lastPaidPeriod(dues)).toBeNull();
  });
});
