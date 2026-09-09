// Pure logic for the bulk price adjustment tool (Productos → ajuste masivo).
// ARS never carries cents anywhere in this app (docs/business-rules.md §
// Argentina, moneda) — rounding to the nearest whole peso is the existing
// convention, not a new one invented for this feature.

export type AdjustmentKind = "percentage" | "fixed";
export type AdjustmentOperation = "increase" | "decrease";

export type BulkAdjustmentInput = {
  kind: AdjustmentKind;
  operation: AdjustmentOperation;
  value: number; // a percentage point (e.g. 5 for 5%) or a fixed ARS amount
};

/**
 * Applies one adjustment to one current price. Never lets a decrease push
 * a price below 0 — a negative price isn't a real price, it's a bug.
 */
export function applyPriceAdjustment(currentPrice: number, adjustment: BulkAdjustmentInput): number {
  const sign = adjustment.operation === "increase" ? 1 : -1;
  const delta =
    adjustment.kind === "percentage" ? currentPrice * (adjustment.value / 100) : adjustment.value;
  const next = currentPrice + sign * delta;
  return Math.max(0, Math.round(next));
}

export type PricePreviewRow = {
  variantId: string;
  label: string;
  currentPrice: number;
  newPrice: number;
};

export function buildAdjustmentPreview(
  rows: { variantId: string; label: string; currentPrice: number }[],
  adjustment: BulkAdjustmentInput
): PricePreviewRow[] {
  return rows.map((r) => ({
    variantId: r.variantId,
    label: r.label,
    currentPrice: r.currentPrice,
    newPrice: applyPriceAdjustment(r.currentPrice, adjustment),
  }));
}
