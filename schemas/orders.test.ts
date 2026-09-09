import { describe, it, expect } from "vitest";
import { createOrderSchema, orderItemInputSchema } from "./orders";

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
});
