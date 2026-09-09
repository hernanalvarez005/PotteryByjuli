import { describe, it, expect } from "vitest";
import { summarizeStockByProduct, type StockRow } from "./inventory";

function row(overrides: Partial<StockRow>): StockRow {
  return {
    inventoryItemId: "item-1",
    locationId: "loc-1",
    locationName: "La Plata",
    productLabel: "Taza clásica",
    physical: 0,
    reserved: 0,
    available: 0,
    minQuantity: null,
    ...overrides,
  };
}

describe("summarizeStockByProduct", () => {
  it("sums real per-location numbers into a total, never doubling one location's count", () => {
    const rows = [
      row({ locationId: "la-plata", locationName: "La Plata", physical: 10, available: 10 }),
      row({ locationId: "tres-lomas", locationName: "Tres Lomas", physical: 5, available: 5 }),
    ];
    const [summary] = summarizeStockByProduct(rows);
    expect(summary.totalPhysical).toBe(15);
    expect(summary.totalAvailable).toBe(15);
    // The regression this guards: a bug that shows the same number at
    // every location (La Plata = 15, Tres Lomas = 15) instead of the real
    // split (10 / 5) — each location's own row must keep its own number.
    expect(summary.byLocation.find((l) => l.locationId === "la-plata")?.physical).toBe(10);
    expect(summary.byLocation.find((l) => l.locationId === "tres-lomas")?.physical).toBe(5);
  });

  it("keeps a location with zero stock as its own row, not omitted", () => {
    const rows = [
      row({ locationId: "la-plata", physical: 4, available: 4 }),
      row({ locationId: "tres-lomas", locationName: "Tres Lomas", physical: 0, available: 0 }),
    ];
    const [summary] = summarizeStockByProduct(rows);
    expect(summary.byLocation).toHaveLength(2);
    expect(summary.totalPhysical).toBe(4);
  });

  it("groups by inventory item, one summary per product", () => {
    const rows = [
      row({ inventoryItemId: "item-1", productLabel: "Taza clásica", physical: 3 }),
      row({ inventoryItemId: "item-2", productLabel: "Mate", physical: 7 }),
    ];
    const summaries = summarizeStockByProduct(rows);
    expect(summaries).toHaveLength(2);
    expect(summaries.map((s) => s.productLabel).sort()).toEqual(["Mate", "Taza clásica"]);
  });

  it("reserved and available roll up the same way as physical", () => {
    const rows = [
      row({ locationId: "la-plata", physical: 10, reserved: 3, available: 7 }),
      row({ locationId: "tres-lomas", physical: 5, reserved: 1, available: 4 }),
    ];
    const [summary] = summarizeStockByProduct(rows);
    expect(summary.totalReserved).toBe(4);
    expect(summary.totalAvailable).toBe(11);
  });
});
