import { describe, it, expect } from "vitest";
import {
  computeDueDisplayStatus,
  computeDueBalance,
  computeDueSummary,
  formatPeriodLabel,
  lastPaidPeriod,
  previousPeriod,
  nextPeriod,
  lastDayOfPeriod,
  isEligibleWithoutDue,
  classifyForPeriod,
  type EnrollmentForPeriod,
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

describe("lastDayOfPeriod", () => {
  it("returns the real last day of a 30/31-day month", () => {
    expect(lastDayOfPeriod("2026-09")).toBe("2026-09-30");
    expect(lastDayOfPeriod("2026-10")).toBe("2026-10-31");
  });

  it("handles February correctly, leap or not", () => {
    expect(lastDayOfPeriod("2026-02")).toBe("2026-02-28"); // 2026 no es bisiesto
    expect(lastDayOfPeriod("2028-02")).toBe("2028-02-29"); // 2028 sí
  });
});

// Auditoría "Ventas: fecha real, canal, comisiones y talleres" (G.1),
// corrección aprobada: "tiene monthly_fee" nunca alcanza solo — hace
// falta que a la fecha ya le tocara pagar.
describe("isEligibleWithoutDue", () => {
  function enrollment(overrides: Partial<EnrollmentForPeriod>): EnrollmentForPeriod {
    return { id: "e1", status: "active", startDate: "2026-01-01", monthlyFee: 10000, ...overrides };
  }

  it("is eligible when active, with a fee, and enrolled before the period ended", () => {
    expect(isEligibleWithoutDue(enrollment({}), "2026-09")).toBe(true);
  });

  it("is NOT eligible when inactive, even with a fee configured — this is the exact bug the correction fixes", () => {
    expect(isEligibleWithoutDue(enrollment({ status: "paused" }), "2026-09")).toBe(false);
    expect(isEligibleWithoutDue(enrollment({ status: "cancelled" }), "2026-09")).toBe(false);
  });

  it("is NOT eligible without any monthly fee configured, regardless of status", () => {
    expect(isEligibleWithoutDue(enrollment({ monthlyFee: null }), "2026-09")).toBe(false);
  });

  it("is NOT eligible for a period before the enrollment even started", () => {
    expect(isEligibleWithoutDue(enrollment({ startDate: "2026-10-01" }), "2026-09")).toBe(false);
  });

  it("an enrollment that started mid-month is eligible for that whole month — the confirmed 'sin prorrateo' policy", () => {
    expect(isEligibleWithoutDue(enrollment({ startDate: "2026-09-28" }), "2026-09")).toBe(true);
  });

  it("started on the last calendar day of the period is still eligible", () => {
    expect(isEligibleWithoutDue(enrollment({ startDate: "2026-09-30" }), "2026-09")).toBe(true);
  });

  it("started the day after the period ended is not eligible for that period", () => {
    expect(isEligibleWithoutDue(enrollment({ startDate: "2026-10-01" }), "2026-09")).toBe(false);
  });
});

describe("classifyForPeriod", () => {
  const period = "2026-09";
  function enrollment(overrides: Partial<EnrollmentForPeriod>): EnrollmentForPeriod {
    return { id: "e1", status: "active", startDate: "2026-01-01", monthlyFee: 10000, ...overrides };
  }

  it("with an existing due: cancelled always wins, regardless of balance", () => {
    const summary = computeDueSummary({ status: "cancelled", amount: 10000 }, [], [{ amount: 10000 }]);
    expect(classifyForPeriod(enrollment({}), period, summary)).toBe("excluded");
  });

  it("with an existing due: balance <= 0 is paid", () => {
    const summary = computeDueSummary({ status: "pending", amount: 10000 }, [], [{ amount: 10000 }]);
    expect(classifyForPeriod(enrollment({}), period, summary)).toBe("paid");
  });

  it("with an existing due: balance > 0 (partial included) is debtor", () => {
    const summary = computeDueSummary({ status: "pending", amount: 10000 }, [], [{ amount: 4000 }]);
    expect(classifyForPeriod(enrollment({}), period, summary)).toBe("debtor");
  });

  it("a due already fully paid, with an extra added afterwards, flips back to debtor automatically — same computeDueSummary, no special case", () => {
    const summary = computeDueSummary(
      { status: "pending", amount: 10000 },
      [{ amount: 2000, voided_at: null }],
      [{ amount: 10000 }] // same old payment, nothing new
    );
    expect(classifyForPeriod(enrollment({}), period, summary)).toBe("debtor");
  });

  it("without any due: debtor only when genuinely eligible for the period", () => {
    expect(classifyForPeriod(enrollment({}), period, null)).toBe("debtor");
  });

  it("without any due: excluded when inactive — never a manufactured debt", () => {
    expect(classifyForPeriod(enrollment({ status: "cancelled" }), period, null)).toBe("excluded");
  });

  it("without any due: excluded when there was never a fee configured", () => {
    expect(classifyForPeriod(enrollment({ monthlyFee: null }), period, null)).toBe("excluded");
  });

  it("without any due: excluded when the enrollment started after the period", () => {
    expect(classifyForPeriod(enrollment({ startDate: "2026-10-05" }), period, null)).toBe("excluded");
  });
});
