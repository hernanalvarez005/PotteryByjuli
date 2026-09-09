import { describe, it, expect } from "vitest";
import { applyPriceAdjustment, buildAdjustmentPreview } from "./pricing";

// The brief's own worked example (sección 65): A=10000, B=20000, +5% ->
// A=10500, B=21000.
describe("applyPriceAdjustment", () => {
  it("matches the brief's own +5% example exactly", () => {
    expect(applyPriceAdjustment(10000, { kind: "percentage", operation: "increase", value: 5 })).toBe(10500);
    expect(applyPriceAdjustment(20000, { kind: "percentage", operation: "increase", value: 5 })).toBe(21000);
  });

  it("decreases by a percentage", () => {
    expect(applyPriceAdjustment(20000, { kind: "percentage", operation: "decrease", value: 10 })).toBe(18000);
  });

  it("applies a fixed amount, not a percentage", () => {
    expect(applyPriceAdjustment(20000, { kind: "fixed", operation: "increase", value: 1500 })).toBe(21500);
  });

  it("rounds to the nearest whole peso — ARS never carries cents here", () => {
    expect(applyPriceAdjustment(10333, { kind: "percentage", operation: "increase", value: 5 })).toBe(10850);
  });

  it("never lets a decrease push the price below zero", () => {
    expect(applyPriceAdjustment(1000, { kind: "fixed", operation: "decrease", value: 5000 })).toBe(0);
  });
});

describe("buildAdjustmentPreview", () => {
  it("computes current -> new for every row without mutating the input", () => {
    const rows = [
      { variantId: "a", label: "Taza clásica", currentPrice: 20000 },
      { variantId: "b", label: "Mate", currentPrice: 18000 },
    ];
    const preview = buildAdjustmentPreview(rows, { kind: "percentage", operation: "increase", value: 5 });
    expect(preview).toEqual([
      { variantId: "a", label: "Taza clásica", currentPrice: 20000, newPrice: 21000 },
      { variantId: "b", label: "Mate", currentPrice: 18000, newPrice: 18900 },
    ]);
    expect(rows[0].currentPrice).toBe(20000); // original untouched
  });
});
