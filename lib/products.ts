import { createClient } from "@/lib/supabase/server";

export type ProductListRow = {
  id: string;
  name: string;
  description: string | null;
  cost_estimate: number | null;
  is_active: boolean;
  category_id: string | null;
  product_categories: { name: string } | null;
  product_variants: { id: string; name: string; sku: string | null; is_active: boolean }[];
};

export type PriceByVariant = Record<string, { retail?: number; wholesale?: number }>;

export type ProductStatusFilter = "all" | "active" | "inactive";

/** Products + their variants + category name, newest-first is irrelevant —
 * sorted by name. `status` is applied server-side (a real `.eq()`, not a
 * fetch-all-then-filter) — there's no pagination on this list today, so
 * this stays trivial without needing to preserve one. */
export async function getProductsWithVariants(status: ProductStatusFilter = "active"): Promise<ProductListRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select(
      "id,name,description,cost_estimate,is_active,category_id,product_categories(name),product_variants(id,name,sku,is_active)"
    )
    .order("name");

  if (status !== "all") {
    query = query.eq("is_active", status === "active");
  }

  const { data } = await query;

  return (data ?? []) as unknown as ProductListRow[];
}

/** Retail/wholesale price per variant id, for the given variant ids. */
export async function getPricesForVariants(variantIds: string[]): Promise<PriceByVariant> {
  if (variantIds.length === 0) return {};

  const supabase = await createClient();
  const { data } = await supabase
    .from("price_list_items")
    .select("product_variant_id,unit_price,price_lists(code)")
    .in("product_variant_id", variantIds);

  const byVariant: PriceByVariant = {};
  for (const row of (data ?? []) as unknown as {
    product_variant_id: string;
    unit_price: number;
    price_lists: { code: string } | null;
  }[]) {
    const code = row.price_lists?.code;
    if (code !== "retail" && code !== "wholesale") continue;
    byVariant[row.product_variant_id] ??= {};
    byVariant[row.product_variant_id][code] = row.unit_price;
  }
  return byVariant;
}
