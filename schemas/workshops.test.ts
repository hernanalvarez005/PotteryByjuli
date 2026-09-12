import { describe, it, expect } from "vitest";
import { groupSchema, dueSchema, duePaymentSchema, groupCapacitySchema } from "./workshops";

const baseGroup = {
  program_id: "11111111-1111-4111-8111-111111111111",
  name: "Martes 18hs",
  schedule: "",
  weekday: "",
  start_time: "",
  end_time: "",
  location_id: "",
  capacity: "8",
};

describe("groupSchema.monthly_fee", () => {
  it("is optional — a group with no fee configured yet is valid", () => {
    const result = groupSchema.safeParse({ ...baseGroup, monthly_fee: "" });
    if (!result.success) throw new Error("expected success");
    expect(result.data.monthly_fee).toBeNull();
  });

  it("parses a real fee", () => {
    const result = groupSchema.safeParse({ ...baseGroup, monthly_fee: "45000" });
    if (!result.success) throw new Error("expected success");
    expect(result.data.monthly_fee).toBe(45000);
  });

  it("rejects a negative fee", () => {
    expect(groupSchema.safeParse({ ...baseGroup, monthly_fee: "-100" }).success).toBe(false);
  });
});

describe("groupCapacitySchema", () => {
  it("accepts a positive integer", () => {
    const result = groupCapacitySchema.safeParse({ capacity: "8" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.capacity).toBe(8);
  });

  it("rejects zero, negative or non-integer values", () => {
    expect(groupCapacitySchema.safeParse({ capacity: "0" }).success).toBe(false);
    expect(groupCapacitySchema.safeParse({ capacity: "-1" }).success).toBe(false);
    expect(groupCapacitySchema.safeParse({ capacity: "3.5" }).success).toBe(false);
  });
});

describe("dueSchema.period", () => {
  it("accepts AAAA-MM", () => {
    expect(dueSchema.safeParse({ period: "2026-09", amount: "45000" }).success).toBe(true);
  });

  it("rejects anything else, so a generated due can't drift from the AAAA-MM convention", () => {
    expect(dueSchema.safeParse({ period: "septiembre 2026", amount: "45000" }).success).toBe(false);
    expect(dueSchema.safeParse({ period: "2026-9", amount: "45000" }).success).toBe(false);
  });
});

describe("duePaymentSchema", () => {
  it("requires a positive amount — a 0 payment isn't a real payment", () => {
    expect(duePaymentSchema.safeParse({ amount: "0", paid_at: "2026-09-10" }).success).toBe(false);
    expect(duePaymentSchema.safeParse({ amount: "1000", paid_at: "2026-09-10" }).success).toBe(true);
  });

  it("method and account are optional", () => {
    const result = duePaymentSchema.safeParse({
      amount: "1000",
      paid_at: "2026-09-10",
      method_id: "",
      account_id: "",
    });
    if (!result.success) throw new Error("expected success");
    expect(result.data.method_id).toBeNull();
    expect(result.data.account_id).toBeNull();
  });

  // paid_at siempre explícito, nunca un atajo "si es hoy, se omite y cae
  // el default now()" (precisión de la usuaria en la tanda de mejoras
  // operativas) — un único contrato formulario→paid_at→DB.
  it("requires paid_at explicitly — no two-path shortcut for 'today'", () => {
    expect(duePaymentSchema.safeParse({ amount: "1000" }).success).toBe(false);
  });

  it("rejects a paid_at that isn't a plain YYYY-MM-DD date", () => {
    expect(duePaymentSchema.safeParse({ amount: "1000", paid_at: "10/09/2026" }).success).toBe(false);
    expect(duePaymentSchema.safeParse({ amount: "1000", paid_at: "2026-09-10T12:00:00Z" }).success).toBe(false);
  });

  // Real bug found alongside the order-form one (2026-09-10): dues-panel.tsx's
  // RegisterPaymentDialog never rendered a "Cuenta" input at all (fixed
  // 2026-09-12, sección 14 de la tanda de usabilidad) — so
  // formData.get("account_id") could be a bare `null`, never "". The old
  // `.optional().or(z.literal(""))` pattern doesn't tolerate that; only
  // optionalUuid() (lib/zod-helpers.ts) does. Kept as a regression test
  // even now that the field renders — a checkbox/select left untouched
  // still produces this exact shape.
  it("accepts account_id/method_id/reference/notes as bare nulls when left untouched", () => {
    const result = duePaymentSchema.safeParse({
      amount: "1000",
      paid_at: "2026-09-10",
      method_id: null,
      account_id: null,
      reference: null,
      notes: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.account_id).toBeNull();
      expect(result.data.method_id).toBeNull();
      expect(result.data.notes).toBeNull();
    }
  });

  // Nota de corrección (sección 14) — sólo se usa al editar un pago ya
  // registrado, nunca obligatoria.
  it("accepts a correction note", () => {
    const result = duePaymentSchema.safeParse({
      amount: "1000",
      paid_at: "2026-09-10",
      notes: "Importe mal cargado, era $12.000",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notes).toBe("Importe mal cargado, era $12.000");
  });
});
