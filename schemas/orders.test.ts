import { describe, it, expect } from "vitest";
import { createOrderSchema, orderItemInputSchema, paymentSchema } from "./orders";

const validItem = {
  product_variant_id: "11111111-1111-4111-8111-111111111111",
  quantity: 2,
  unit_price: 1500,
};

const baseOrder = {
  business_unit_id: "22222222-2222-4222-8222-222222222222",
  customer_id: "33333333-3333-4333-8333-333333333333",
  location_id: "",
  origin_channel_id: "",
  closing_channel_id: "",
  delivery_method: "",
  delivery_address: "",
  estimated_date: "",
  notes: "",
  items: [validItem],
};

describe("orderItemInputSchema", () => {
  it("accepts a valid item", () => {
    expect(orderItemInputSchema.safeParse(validItem).success).toBe(true);
  });

  it("rejects a zero quantity", () => {
    expect(orderItemInputSchema.safeParse({ ...validItem, quantity: 0 }).success).toBe(false);
  });

  it("rejects a negative unit price", () => {
    expect(orderItemInputSchema.safeParse({ ...validItem, unit_price: -1 }).success).toBe(false);
  });
});

describe("createOrderSchema", () => {
  it("accepts a well-formed order with one item", () => {
    const result = createOrderSchema.safeParse(baseOrder);
    expect(result.success).toBe(true);
  });

  it("rejects an order with no items — every order needs at least one product", () => {
    const result = createOrderSchema.safeParse({ ...baseOrder, items: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a missing customer_id", () => {
    const result = createOrderSchema.safeParse({ ...baseOrder, customer_id: "" });
    expect(result.success).toBe(false);
  });

  it("turns blank optional fields into null instead of keeping empty strings", () => {
    const result = createOrderSchema.safeParse(baseOrder);
    if (!result.success) throw new Error("expected success");
    expect(result.data.location_id).toBeNull();
    expect(result.data.delivery_method).toBeNull();
    expect(result.data.notes).toBeNull();
  });

  // Real production bug (2026-09-10): order-form.tsx only renders the
  // "Dirección de envío" input when delivery_method is "shipping" —
  // formData.get("delivery_address") is a bare `null` (not `""`) for
  // every other delivery method, which broke order creation entirely for
  // "Retiro"/"Otro" (Zod's generic "Invalid input" from
  // .optional().or(z.literal(""))` not tolerating a raw `null`). This
  // reproduces exactly the FormData shape a real submission produces —
  // unlike `baseOrder` above, which always used `""` and so never
  // exercised the actual bug.
  it("accepts a pickup order where the never-rendered delivery_address field is a bare null, not ''", () => {
    const asSubmittedByTheRealForm = {
      ...baseOrder,
      location_id: null,
      origin_channel_id: null,
      closing_channel_id: null,
      delivery_method: "pickup",
      delivery_address: null, // never rendered for pickup/other — this is what FormData.get() returns
      estimated_date: null,
      notes: null,
    };
    const result = createOrderSchema.safeParse(asSubmittedByTheRealForm);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.delivery_address).toBeNull();
      expect(result.data.delivery_method).toBe("pickup");
    }
  });
});

// paid_at siempre explícito, nunca un atajo "si es hoy, se omite y cae el
// default now()" (precisión de la usuaria en la tanda de mejoras
// operativas) — un único contrato formulario→paid_at→DB.
describe("paymentSchema.paid_at", () => {
  it("is required — no two-path shortcut for 'today'", () => {
    expect(paymentSchema.safeParse({ amount: "1000" }).success).toBe(false);
  });

  it("accepts a plain YYYY-MM-DD date", () => {
    expect(paymentSchema.safeParse({ amount: "1000", paid_at: "2026-09-10" }).success).toBe(true);
  });

  it("rejects anything that isn't a plain date", () => {
    expect(paymentSchema.safeParse({ amount: "1000", paid_at: "10/09/2026" }).success).toBe(false);
    expect(paymentSchema.safeParse({ amount: "1000", paid_at: "2026-09-10T12:00:00Z" }).success).toBe(false);
  });
});
