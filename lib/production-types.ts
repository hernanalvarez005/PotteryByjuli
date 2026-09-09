/**
 * Types + pure helpers shared by server data-fetching (lib/production.ts)
 * and client components (app/(app)/produccion/*). Kept in its own file,
 * with zero imports, so client components never accidentally pull in
 * lib/supabase/server.ts (which depends on next/headers and can't be
 * bundled for the browser).
 */
export type ProductionOrderRow = {
  id: string;
  human_code: string;
  origin: string;
  status: string;
  priority: string;
  quantity: number;
  produced_quantity: number;
  rejected_quantity: number;
  target_date: string | null;
  notes: string | null;
  created_at: string;
  order_id: string | null;
  product_variants: { name: string; products: { name: string } | null } | null;
  locations: { name: string } | null;
};

export function productionItemLabel(row: ProductionOrderRow): string {
  const variant = row.product_variants;
  if (!variant) return "—";
  return variant.name === "Único"
    ? (variant.products?.name ?? "—")
    : `${variant.products?.name} — ${variant.name}`;
}
