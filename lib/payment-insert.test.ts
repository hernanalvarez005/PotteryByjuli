import { describe, it, expect } from "vitest";
import { paymentSchema } from "@/schemas/orders";
import { buildOrderPaymentInsert } from "./payment-insert";

// Columnas reales de `payments` que un alta puede escribir. Si `paymentSchema` suma un campo que
// no es columna (como `reason`), el INSERT del alta NO puede llevarlo (regresión real: PR #53
// rompió "Registrar pago" en todos los pedidos).
const WRITABLE_COLUMNS = ["order_id", "amount", "paid_at", "method_id", "account_id", "reference", "notes", "fee_amount", "created_by"];

describe("buildOrderPaymentInsert", () => {
  const form = { amount: "52200", paid_at: "2026-10-18", method_id: "", account_id: "", reference: "", notes: "", fee_amount: "", reason: "" };

  it("sólo lleva columnas de payments — nunca `reason` ni otro campo del schema", () => {
    const parsed = paymentSchema.parse(form);
    const row = buildOrderPaymentInsert(parsed, "order-1", "user-1");
    expect(Object.keys(row).sort()).toEqual([...WRITABLE_COLUMNS].sort());
    expect(row).not.toHaveProperty("reason");
  });

  it("aun si el formulario trae un motivo, no llega al INSERT", () => {
    const parsed = paymentSchema.parse({ ...form, reason: "no debería viajar" });
    expect(parsed.reason).toBe("no debería viajar");
    expect(buildOrderPaymentInsert(parsed, "order-1", "user-1")).not.toHaveProperty("reason");
  });

  it("mapea valores: fecha al mediodía de Argentina, vacíos → null, comisión 0", () => {
    const row = buildOrderPaymentInsert(paymentSchema.parse(form), "order-1", "user-1");
    expect(row).toEqual({
      order_id: "order-1",
      amount: 52200,
      paid_at: "2026-10-18T12:00:00-03:00",
      method_id: null,
      account_id: null,
      reference: null,
      notes: null,
      fee_amount: 0,
      created_by: "user-1",
    });
  });
});
