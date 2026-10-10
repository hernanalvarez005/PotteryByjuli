import { describe, it, expect } from "vitest";
import { buildPaymentPatch, describeCorrection, type PaymentSnapshot, type PaymentFormValues } from "./payment-corrections";

// 2026-09-04 15:30 en Argentina (UTC-3) — una hora "real" de cobro, no el mediodía del formulario.
const REAL_PAID_AT = "2026-09-04T18:30:00+00:00";

const current: PaymentSnapshot = {
  amount: 522000,
  paid_at: REAL_PAID_AT,
  method_id: "m1",
  account_id: null,
  reference: "OP 123",
  notes: null,
  fee_amount: 0,
};

const same: PaymentFormValues = {
  amount: 522000,
  paid_at: "2026-09-04",
  method_id: "m1",
  account_id: null,
  reference: "OP 123",
  notes: null,
  fee_amount: 0,
};

describe("buildPaymentPatch", () => {
  it("no manda nada si el formulario vuelve igual (aun con la hora real distinta del mediodía)", () => {
    expect(buildPaymentPatch(current, same)).toEqual({});
  });

  it("corregir sólo el importe NO toca paid_at (conserva la hora real del cobro)", () => {
    const patch = buildPaymentPatch(current, { ...same, amount: 52200 });
    expect(patch).toEqual({ amount: 52200 });
    expect("paid_at" in patch).toBe(false);
  });

  it("compara el día en hora Argentina, no en UTC: un cobro a las 23:30 ART (02:30 UTC del día siguiente) no 'cambia' de día", () => {
    const late = { ...current, paid_at: "2026-09-05T02:30:00+00:00" }; // 04/09 23:30 ART
    expect(buildPaymentPatch(late, { ...same, paid_at: "2026-09-04" })).toEqual({});
    expect(buildPaymentPatch(late, { ...same, paid_at: "2026-09-05" })).toEqual({ paid_at: "2026-09-05T12:00:00-03:00" });
  });

  it("cambiar el día manda paid_at al mediodía de Argentina", () => {
    expect(buildPaymentPatch(current, { ...same, paid_at: "2026-09-10" })).toEqual({ paid_at: "2026-09-10T12:00:00-03:00" });
  });

  it("vaciar un campo opcional manda null; ausente-vs-vacío no es un cambio", () => {
    expect(buildPaymentPatch(current, { ...same, method_id: null })).toEqual({ method_id: null });
    expect(buildPaymentPatch(current, { ...same, reference: "" })).toEqual({ reference: null });
    expect(buildPaymentPatch(current, { ...same, notes: "   " })).toEqual({});
  });

  it("normaliza espacios y detecta cada campo", () => {
    const patch = buildPaymentPatch(current, {
      ...same,
      reference: "  OP 999 ",
      notes: " mal cargado ",
      fee_amount: 100,
      account_id: "a1",
    });
    expect(patch).toEqual({ reference: "OP 999", notes: "mal cargado", fee_amount: 100, account_id: "a1" });
  });

  it("compara importes como números ('522000.00' vs 522000)", () => {
    expect(buildPaymentPatch({ ...current, amount: Number("522000.00") }, same)).toEqual({});
  });
});

describe("describeCorrection", () => {
  const lookups = { methods: new Map([["m1", "Transferencia"], ["m2", "Efectivo"]]), accounts: new Map<string, string>() };

  it("muestra sólo lo que cambió, con nombres legibles y el motivo", () => {
    const entry = describeCorrection(
      {
        id: "c1",
        changed_at: "2026-10-10T12:00:00Z",
        changed_by: "u1",
        previous_values: { amount: 522000, paid_at: REAL_PAID_AT, method_id: "m1", account_id: null, reference: null, notes: null, fee_amount: 0 },
        new_values: { amount: 52200, paid_at: REAL_PAID_AT, method_id: "m2", account_id: null, reference: null, notes: null, fee_amount: 0 },
        reason: "importe mal cargado",
      },
      lookups,
      "Lucía"
    );
    expect(entry.changedByName).toBe("Lucía");
    expect(entry.reason).toBe("importe mal cargado");
    expect(entry.changes.map((c) => c.field)).toEqual(["amount", "method_id"]);
    expect(entry.changes[1]).toMatchObject({ label: "Medio de pago", from: "Transferencia", to: "Efectivo" });
    expect(entry.changes[0].from).toContain("522.000");
    expect(entry.changes[0].to).toContain("52.200");
  });

  it("paid_at con distinto formato pero el mismo instante no aparece como cambio", () => {
    const entry = describeCorrection(
      {
        id: "c2",
        changed_at: "2026-10-10T12:00:00Z",
        changed_by: null,
        previous_values: { amount: 1, paid_at: "2026-09-04T18:30:00+00:00" },
        new_values: { amount: 2, paid_at: "2026-09-04T15:30:00-03:00" },
        reason: null,
      },
      lookups,
      null
    );
    expect(entry.changes.map((c) => c.field)).toEqual(["amount"]);
  });

  it("un medio de pago que ya no existe se marca, no revienta", () => {
    const entry = describeCorrection(
      { id: "c3", changed_at: "x", changed_by: null, previous_values: { method_id: "gone" }, new_values: { method_id: null }, reason: null },
      lookups,
      null
    );
    expect(entry.changes[0]).toMatchObject({ from: "(medio eliminado)", to: "—" });
  });
});
