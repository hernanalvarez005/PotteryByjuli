import { createClient } from "@/lib/supabase/server";

export type StockRow = {
  inventoryItemId: string;
  locationId: string;
  locationName: string;
  productLabel: string;
  physical: number;
  reserved: number;
  available: number;
  minQuantity: number | null;
};

export type ProductStockSummary = {
  inventoryItemId: string;
  productLabel: string;
  byLocation: Omit<StockRow, "inventoryItemId" | "productLabel">[];
  totalPhysical: number;
  totalReserved: number;
  totalAvailable: number;
};

type InventoryItemRow = {
  id: string;
  product_variants: {
    name: string;
    is_active: boolean;
    products: { name: string; is_active: boolean } | null;
  } | null;
};

/** Finished-goods stock, one row per (item, location) that's active on both sides. */
export async function getFinishedGoodsStock(): Promise<StockRow[]> {
  const supabase = await createClient();

  const [{ data: items }, { data: locations }, { data: movements }, { data: reservations }, { data: thresholds }] =
    await Promise.all([
      supabase
        .from("inventory_items")
        .select("id,product_variants(name,is_active,products(name,is_active))")
        .eq("item_type", "finished_good")
        .eq("is_active", true),
      supabase.from("locations").select("id,name").eq("is_active", true).order("name"),
      supabase.from("inventory_movements").select("inventory_item_id,location_id,quantity"),
      supabase
        .from("inventory_reservations")
        .select("inventory_item_id,location_id,quantity")
        .eq("status", "active"),
      supabase.from("stock_thresholds").select("inventory_item_id,location_id,min_quantity"),
    ]);

  const physicalByKey = new Map<string, number>();
  for (const m of (movements ?? []) as { inventory_item_id: string; location_id: string; quantity: number }[]) {
    const key = `${m.inventory_item_id}:${m.location_id}`;
    physicalByKey.set(key, (physicalByKey.get(key) ?? 0) + m.quantity);
  }

  const reservedByKey = new Map<string, number>();
  for (const r of (reservations ?? []) as { inventory_item_id: string; location_id: string; quantity: number }[]) {
    const key = `${r.inventory_item_id}:${r.location_id}`;
    reservedByKey.set(key, (reservedByKey.get(key) ?? 0) + r.quantity);
  }

  const thresholdByKey = new Map<string, number>();
  const thresholdByItem = new Map<string, number>();
  for (const t of (thresholds ?? []) as { inventory_item_id: string; location_id: string | null; min_quantity: number }[]) {
    if (t.location_id) thresholdByKey.set(`${t.inventory_item_id}:${t.location_id}`, t.min_quantity);
    else thresholdByItem.set(t.inventory_item_id, t.min_quantity);
  }

  const activeItems = (items ?? []).filter((item) => {
    const row = item as unknown as InventoryItemRow;
    return row.product_variants?.is_active && row.product_variants.products?.is_active;
  }) as unknown as InventoryItemRow[];

  const rows: StockRow[] = [];
  for (const item of activeItems) {
    const variant = item.product_variants;
    const label =
      variant?.name === "Único"
        ? (variant?.products?.name ?? "—")
        : `${variant?.products?.name ?? "—"} — ${variant?.name}`;

    for (const location of locations ?? []) {
      const key = `${item.id}:${location.id}`;
      rows.push({
        inventoryItemId: item.id,
        locationId: location.id,
        locationName: location.name,
        productLabel: label,
        physical: physicalByKey.get(key) ?? 0,
        reserved: reservedByKey.get(key) ?? 0,
        available: (physicalByKey.get(key) ?? 0) - (reservedByKey.get(key) ?? 0),
        minQuantity: thresholdByKey.get(key) ?? thresholdByItem.get(item.id) ?? null,
      });
    }
  }

  return rows;
}

/**
 * Groups the flat (item, location) rows into one summary per product, with
 * a per-location breakdown plus totals. "Todas las ubicaciones" is
 * genuinely a sum across real, distinct location rows — never a second
 * copy of the same number (docs/business-rules.md § Stock por ubicación).
 * Pure — no I/O, so it's unit-testable without a database.
 */
export function summarizeStockByProduct(rows: StockRow[]): ProductStockSummary[] {
  const byItem = new Map<string, ProductStockSummary>();

  for (const row of rows) {
    let summary = byItem.get(row.inventoryItemId);
    if (!summary) {
      summary = {
        inventoryItemId: row.inventoryItemId,
        productLabel: row.productLabel,
        byLocation: [],
        totalPhysical: 0,
        totalReserved: 0,
        totalAvailable: 0,
      };
      byItem.set(row.inventoryItemId, summary);
    }
    summary.byLocation.push({
      locationId: row.locationId,
      locationName: row.locationName,
      physical: row.physical,
      reserved: row.reserved,
      available: row.available,
      minQuantity: row.minQuantity,
    });
    summary.totalPhysical += row.physical;
    summary.totalReserved += row.reserved;
    summary.totalAvailable += row.available;
  }

  return [...byItem.values()];
}
