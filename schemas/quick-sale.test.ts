import { describe, it, expect } from "vitest";
import { quickSaleSchema, quickSaleItemSchema } from "./quick-sale";

const validItem = {
  product_variant_id: "11111111-1111-4111-8111-111111111111",
  quantity: 2,
  expected_unit_price: 2000,
};

const baseSale = {
  location_id: "22222222-2222-4222-8222-222222222222",
  payment_method_id: "33333333-3333-4333-8333-333333333333",
  payment_account_id: "",
  paid_at: "2026-09-11",
  customer_id: "",
  channel_id: "",
  client_request_id: "44444444-4444-4444-8444-444444444444",
  price_condition_id: "55555555-5555-4555-8555-555555555555",
  expected_total: 4000,
  items: [validItem],
};

describe("quickSaleItemSchema", () => {
  it("accepts a valid item", () => {
    expect(quickSaleItemSchema.safeParse(validItem).success).toBe(true);
  });

  it("rejects a zero or negative quantity", () => {
    expect(quickSaleItemSchema.safeParse({ ...validItem, quantity: 0 }).success).toBe(false);
    expect(quickSaleItemSchema.safeParse({ ...validItem, quantity: -1 }).success).toBe(false);
  });

  it("never validates unit_price directly — this schema only carries expected_unit_price, purely for the client-side staleness check, never what's charged", () => {
    expect(Object.keys(quickSaleItemSchema.shape)).not.toContain("unit_price");
  });
});

describe("quickSaleSchema", () => {
  it("accepts a well-formed sale with optional fields left blank", () => {
    const result = quickSaleSchema.safeParse(baseSale);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customer_id).toBeNull();
      expect(result.data.channel_id).toBeNull();
      expect(result.data.payment_account_id).toBeNull();
    }
  });

  it("requires a price_condition_id — a sale is always quoted and charged under a specific condition", () => {
    expect(quickSaleSchema.safeParse({ ...baseSale, price_condition_id: "" }).success).toBe(false);
  });

  it("rejects a sale with no items", () => {
    expect(quickSaleSchema.safeParse({ ...baseSale, items: [] }).success).toBe(false);
  });

  it("requires location_id and payment_method_id", () => {
    expect(quickSaleSchema.safeParse({ ...baseSale, location_id: "" }).success).toBe(false);
    expect(quickSaleSchema.safeParse({ ...baseSale, payment_method_id: "" }).success).toBe(false);
  });

  it("requires paid_at explicitly — same contract as every other payment form in the app", () => {
    expect(quickSaleSchema.safeParse({ ...baseSale, paid_at: "" }).success).toBe(false);
    expect(quickSaleSchema.safeParse({ ...baseSale, paid_at: "11/09/2026" }).success).toBe(false);
  });

  // Same FormData shape a real submission produces: fields the form left
  // untouched (no customer picked, no account chosen) arrive as bare
  // `null`, not `""` — this is exactly the bug class fixed across the
  // rest of the app this session (lib/zod-helpers.ts).
  it("accepts every optional field as a bare null, matching what formData.get() actually returns", () => {
    const asSubmittedByTheRealForm = {
      ...baseSale,
      payment_account_id: null,
      customer_id: null,
      channel_id: null,
    };
    const result = quickSaleSchema.safeParse(asSubmittedByTheRealForm);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payment_account_id).toBeNull();
      expect(result.data.customer_id).toBeNull();
      expect(result.data.channel_id).toBeNull();
    }
  });

  it("requires client_request_id — idempotency depends on it always being present", () => {
    expect(quickSaleSchema.safeParse({ ...baseSale, client_request_id: "" }).success).toBe(false);
  });
});
