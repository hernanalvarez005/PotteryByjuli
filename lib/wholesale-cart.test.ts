import { describe, it, expect } from "vitest";
import { validateWholesaleCart, type CartLine } from "./wholesale-cart";

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    key: "taza-clasica",
    productName: "Taza Clásica",
    quantity: 8,
    unitPrice: 1500,
    minQuantity: null,
    multipleOf: null,
    ...overrides,
  };
}

describe("validateWholesaleCart", () => {
  it("cannot submit an empty cart", () => {
    const result = validateWholesaleCart([], { min_order_amount: null, min_total_units: null });
    expect(result.canSubmit).toBe(false);
  });

  it("allows a cart with no minimums configured", () => {
    const result = validateWholesaleCart([line()], { min_order_amount: null, min_total_units: null });
    expect(result.canSubmit).toBe(true);
    expect(result.totalAmount).toBe(12000);
    expect(result.totalUnits).toBe(8);
  });

  it("reports exactly what's missing to reach the minimum order amount", () => {
    // 8 * 1500 = 12000; minimum is 20000 -> missing 8000, matching the
    // "Te faltan $X para el mínimo mayorista" message shown in the UI.
    const result = validateWholesaleCart([line()], {
      min_order_amount: 20000,
      min_total_units: null,
    });
    expect(result.canSubmit).toBe(false);
    expect(result.missingAmount).toBe(8000);
  });

  it("reports exactly how many units are missing to reach the total-units minimum", () => {
    const result = validateWholesaleCart([line({ quantity: 5 })], {
      min_order_amount: null,
      min_total_units: 20,
    });
    expect(result.missingUnits).toBe(15);
    expect(result.canSubmit).toBe(false);
  });

  it("blocks a line under its own product minimum, even if the cart total is fine", () => {
    const result = validateWholesaleCart(
      [line({ quantity: 2, minQuantity: 4, unitPrice: 100000 })],
      { min_order_amount: null, min_total_units: null }
    );
    expect(result.belowProductMinimums).toHaveLength(1);
    expect(result.canSubmit).toBe(false);
  });

  it("blocks a quantity that doesn't respect the product's multiple", () => {
    const result = validateWholesaleCart([line({ quantity: 5, multipleOf: 4 })], {
      min_order_amount: null,
      min_total_units: null,
    });
    expect(result.wrongMultiples).toHaveLength(1);
    expect(result.canSubmit).toBe(false);
  });

  it("accepts a quantity that's an exact multiple", () => {
    const result = validateWholesaleCart([line({ quantity: 8, multipleOf: 4 })], {
      min_order_amount: null,
      min_total_units: null,
    });
    expect(result.wrongMultiples).toHaveLength(0);
    expect(result.canSubmit).toBe(true);
  });

  it("is satisfied once every condition clears at the same time", () => {
    const result = validateWholesaleCart(
      [
        line({ key: "a", quantity: 4, minQuantity: 4, multipleOf: 4, unitPrice: 3000 }),
        line({ key: "b", quantity: 8, minQuantity: 6, multipleOf: 2, unitPrice: 2500 }),
      ],
      { min_order_amount: 30000, min_total_units: 10 }
    );
    // 4*3000 + 8*2500 = 12000 + 20000 = 32000; 32000 >= 30000, 12 units >= 10
    expect(result.totalAmount).toBe(32000);
    expect(result.totalUnits).toBe(12);
    expect(result.canSubmit).toBe(true);
  });
});
