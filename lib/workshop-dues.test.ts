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
  hasActiveWaiver,
  toWaiverHistory,
  profileDisplayName,
  DUE_STATUS_LABELS,
  type EnrollmentForPeriod,
  type DueWaiverRowRaw,
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
      // Sin exención el resumen es el de siempre.
      baseWaived: false,
      waivedAmount: 0,
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

describe("exención de la cuota base", () => {
  const due = { status: "pending" as const, amount: 50000 };
  const active = [{ reverted_at: null }];
  const closed = [{ reverted_at: "2026-09-20T12:00:00Z" }];

  it("hasActiveWaiver: sólo cuenta un ciclo SIN cerrar; ciclos cerrados o ausentes no eximen", () => {
    expect(hasActiveWaiver(active)).toBe(true);
    expect(hasActiveWaiver(closed)).toBe(false);
    expect(hasActiveWaiver([])).toBe(false);
    expect(hasActiveWaiver(null)).toBe(false);
    expect(hasActiveWaiver(undefined)).toBe(false);
    // Varios ciclos: cerrados + uno activo.
    expect(hasActiveWaiver([...closed, ...active])).toBe(true);
  });

  it("cuota exenta sin extras: balance 0, paid_total 0 (sin pago falso), estado 'waived' — no 'paid' ni 'pending'", () => {
    const summary = computeDueSummary(due, [], [], active);
    expect(summary).toMatchObject({
      baseAmount: 50000, extrasTotal: 0, totalDue: 0, paidTotal: 0, balance: 0, status: "waived", baseWaived: true, waivedAmount: 50000,
    });
    expect(summary.status).not.toBe("paid");
  });

  it("los extras siguen cobrables: sólo la base se exime", () => {
    const items = [{ amount: 8000, voided_at: null }];
    const pending = computeDueSummary(due, items, [], active);
    expect(pending).toMatchObject({ totalDue: 8000, paidTotal: 0, balance: 8000, status: "pending", baseWaived: true });

    const partial = computeDueSummary(due, items, [{ amount: 3000 }], active);
    expect(partial).toMatchObject({ totalDue: 8000, paidTotal: 3000, balance: 5000, status: "partial" });

    const paid = computeDueSummary(due, items, [{ amount: 8000 }], active);
    expect(paid).toMatchObject({ totalDue: 8000, paidTotal: 8000, balance: 0, status: "paid", baseWaived: true });
  });

  it("un extra ANULADO no cuenta: la cuota exenta vuelve a 'waived'", () => {
    const items = [{ amount: 8000, voided_at: "2026-09-21T10:00:00Z" }];
    expect(computeDueSummary(due, items, [], active)).toMatchObject({ totalDue: 0, balance: 0, status: "waived" });
  });

  it("quitar la exención (ciclo cerrado) devuelve la cuota base completa", () => {
    expect(computeDueSummary(due, [], [], closed)).toMatchObject({
      totalDue: 50000, balance: 50000, status: "pending", baseWaived: false, waivedAmount: 0,
    });
  });

  it("quitar la exención con un pago de extras existente → 'partial', sin inconsistencia", () => {
    const items = [{ amount: 8000, voided_at: null }];
    expect(computeDueSummary(due, items, [{ amount: 8000 }], closed)).toMatchObject({
      totalDue: 58000, paidTotal: 8000, balance: 50000, status: "partial",
    });
  });

  it("varios ciclos: la exención vigente es la única que cuenta", () => {
    const cycles = [{ reverted_at: "2026-08-01T00:00:00Z" }, { reverted_at: "2026-09-01T00:00:00Z" }, { reverted_at: null }];
    expect(computeDueSummary(due, [], [], cycles)).toMatchObject({ baseWaived: true, totalDue: 0, status: "waived" });
  });

  it("una cuota cancelada sigue 'cancelled' aunque tenga una exención", () => {
    expect(computeDueSummary({ status: "cancelled", amount: 50000 }, [], [], active).status).toBe("cancelled");
  });

  it("computeDueDisplayStatus: 'waived' sólo si la base está exenta Y no queda nada cobrable", () => {
    expect(computeDueDisplayStatus("pending", 0, 0, true)).toBe("waived");
    expect(computeDueDisplayStatus("pending", 0, 0, false)).toBe("pending"); // total 0 sin exención: como siempre
    expect(computeDueDisplayStatus("pending", 8000, 0, true)).toBe("pending");
    expect(computeDueDisplayStatus("cancelled", 0, 0, true)).toBe("cancelled");
  });

  it("lastPaidPeriod: una cuota exenta NO es un mes pago", () => {
    const dues = [
      { period: "2026-08", status: "pending" as const, amount: 50000, paidAmount: 50000 },
      { period: "2026-09", status: "pending" as const, amount: 0, paidAmount: 0, baseWaived: true },
    ];
    expect(lastPaidPeriod(dues)).toBe("2026-08");
  });

  it("classifyForPeriod: una exenta no es deudora, ni paga, ni excluida", () => {
    const enrollment = { id: "e", status: "active" as const, startDate: "2026-01-01", monthlyFee: 50000 };
    expect(classifyForPeriod(enrollment, "2026-09", { status: "waived", balance: 0 })).toBe("waived");
    // Exenta la base pero con un extra pendiente: sigue siendo deudora por el extra.
    expect(classifyForPeriod(enrollment, "2026-09", { status: "pending", balance: 8000 })).toBe("debtor");
  });

  it("DUE_STATUS_LABELS: 'Exenta' es distinta de 'Pagada'", () => {
    expect(DUE_STATUS_LABELS.waived).toBe("Exenta");
    expect(DUE_STATUS_LABELS.waived).not.toBe(DUE_STATUS_LABELS.paid);
  });
});

describe("toWaiverHistory", () => {
  const raw = (over: Partial<DueWaiverRowRaw>): DueWaiverRowRaw => ({
    id: "w", waived_amount: 50000, reason: null, waived_at: "2026-09-01T10:00:00Z", reverted_at: null, revert_reason: null,
    waived_by_profile: { full_name: "Juli" }, reverted_by_profile: null, ...over,
  });

  it("ordena del ciclo más reciente al más antiguo y conserva quién/cuándo/motivo de eximir y de quitar", () => {
    const history = toWaiverHistory([
      raw({ id: "old", waived_at: "2026-08-01T10:00:00Z", reason: "convenio", reverted_at: "2026-08-15T10:00:00Z", revert_reason: "error", reverted_by_profile: { full_name: "Ana" } }),
      raw({ id: "new", waived_at: "2026-09-01T10:00:00Z", reason: "cortesía" }),
    ]);
    expect(history.map((h) => h.id)).toEqual(["new", "old"]);
    expect(history[0]).toMatchObject({ active: true, reason: "cortesía", waivedByName: "Juli", revertedAt: null });
    expect(history[1]).toMatchObject({ active: false, waivedByName: "Juli", revertedByName: "Ana", revertReason: "error", reason: "convenio" });
  });

  it("ante un empate exacto de fecha, el ciclo vigente va antes que el cerrado", () => {
    const same = "2026-09-01T10:00:00Z";
    const history = toWaiverHistory([
      raw({ id: "closed", waived_at: same, reverted_at: same }),
      raw({ id: "active", waived_at: same }),
    ]);
    expect(history.map((h) => h.id)).toEqual(["active", "closed"]);
  });

  it("tolera null/undefined; sin perfil el nombre es 'Usuario', nunca vacío ni un guion", () => {
    expect(toWaiverHistory(null)).toEqual([]);
    expect(toWaiverHistory(undefined)).toEqual([]);
    expect(toWaiverHistory([raw({ waived_by_profile: null })])[0].waivedByName).toBe("Usuario");
  });

  it("quién eximió y quién quitó usan el mismo fallback: nombre → email → 'Usuario'", () => {
    const [h] = toWaiverHistory([
      raw({
        waived_by_profile: { full_name: null, email: "juli@pottery.test" },
        reverted_at: "2026-09-10T10:00:00Z",
        reverted_by_profile: { full_name: "  ", email: null },
      }),
    ]);
    expect(h.waivedByName).toBe("juli@pottery.test");
    expect(h.revertedByName).toBe("Usuario");
  });

  it("un ciclo vigente no expone 'quién quitó'; uno cerrado sí (con cuándo y por qué)", () => {
    const [active] = toWaiverHistory([raw({})]);
    expect(active).toMatchObject({ active: true, revertedAt: null, revertedByName: null });
    const [closed] = toWaiverHistory([
      raw({ reverted_at: "2026-09-10T10:00:00Z", revert_reason: "error de carga", reverted_by_profile: { full_name: "Ana" } }),
    ]);
    expect(closed).toMatchObject({ active: false, revertedAt: "2026-09-10T10:00:00Z", revertedByName: "Ana", revertReason: "error de carga" });
  });
});

describe("profileDisplayName", () => {
  it("full_name primero, luego email, finalmente 'Usuario'", () => {
    expect(profileDisplayName({ full_name: "Juli", email: "j@x.com" })).toBe("Juli");
    expect(profileDisplayName({ full_name: "", email: "j@x.com" })).toBe("j@x.com");
    expect(profileDisplayName({ full_name: null, email: null })).toBe("Usuario");
    expect(profileDisplayName({ full_name: "   ", email: "  " })).toBe("Usuario");
    expect(profileDisplayName(null)).toBe("Usuario");
    expect(profileDisplayName(undefined)).toBe("Usuario");
  });
});
