/**
 * Pure cart-validation logic for the public wholesale portal — no
 * Supabase/React imports on purpose, so it can run in the browser
 * (app/mayorista/cart-sheet.tsx) and under Vitest with no setup. This is
 * the client-side mirror of the checks submit_wholesale_request() (Fase 5
 * migration) re-runs authoritatively on the server — this file only ever
 * decides what the UI shows before submitting; the RPC is what actually
 * enforces the minimums.
 */

export type CartLine = {
  key: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  minQuantity: number | null;
  multipleOf: number | null;
};

export type WholesaleMinimums = {
  min_order_amount: number | null;
  min_total_units: number | null;
};

export type CartValidation = {
  totalAmount: number;
  totalUnits: number;
  missingAmount: number;
  missingUnits: number;
  belowProductMinimums: CartLine[];
  wrongMultiples: CartLine[];
  canSubmit: boolean;
};

export function validateWholesaleCart(
  lines: CartLine[],
  settings: WholesaleMinimums | null
): CartValidation {
  const totalAmount = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const totalUnits = lines.reduce((sum, l) => sum + l.quantity, 0);

  const missingAmount = settings?.min_order_amount
    ? Math.max(0, settings.min_order_amount - totalAmount)
    : 0;
  const missingUnits = settings?.min_total_units
    ? Math.max(0, settings.min_total_units - totalUnits)
    : 0;
  const belowProductMinimums = lines.filter(
    (l) => l.minQuantity != null && l.quantity < l.minQuantity
  );
  const wrongMultiples = lines.filter(
    (l) => l.multipleOf != null && l.multipleOf > 1 && l.quantity % l.multipleOf !== 0
  );

  return {
    totalAmount,
    totalUnits,
    missingAmount,
    missingUnits,
    belowProductMinimums,
    wrongMultiples,
    canSubmit:
      lines.length > 0 &&
      missingAmount === 0 &&
      missingUnits === 0 &&
      belowProductMinimums.length === 0 &&
      wrongMultiples.length === 0,
  };
}
