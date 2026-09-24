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

/** `name` + `id` (nunca sólo `name`) — dos productos pueden compartir
 * nombre exacto (no hay unicidad en la tabla), y un cursor de un solo
 * campo saltearía/repetiría filas ahí, mismo motivo que el cursor
 * compuesto de getOrdersPage() (lib/orders.ts, H-08 bloque 2). */
export type ProductsPageCursor = { name: string; id: string } | null;

export const PRODUCTS_PAGE_SIZE = 50;

/**
 * Versión paginada + con búsqueda de la lista de /productos (perf audit
 * H-08 bloque 4). getProductsWithVariants()/getPricesForVariants() de
 * arriba NO se tocan — siguen usándose tal cual en /pedidos/nuevo y
 * /precios (fuera de alcance de este bloque; con el dataset actual
 * también rompen con HTTP 414, hallazgo nuevo a resolver aparte).
 *
 * Igual que getOrdersPage(): keyset con cursor compuesto, patrón "peek"
 * (pedir pageSize+1 para saber si hay más sin depender de que el total
 * sea un múltiplo exacto de pageSize), y los precios se resuelven
 * SÓLO para las variantes de los productos de esta página — nunca un
 * `.in()` con el catálogo completo (a 3.000+ variantes eso ya rompe con
 * HTTP 414 hoy, confirmado antes de este cambio).
 */
export async function getProductsPage(
  status: ProductStatusFilter,
  search: string,
  cursor: ProductsPageCursor = null,
  pageSize: number = PRODUCTS_PAGE_SIZE
): Promise<{ products: ProductListRow[]; nextCursor: ProductsPageCursor; prices: PriceByVariant }> {
  const supabase = await createClient();

  let query = supabase
    .from("products")
    .select(
      "id,name,description,cost_estimate,is_active,category_id,product_categories(name),product_variants(id,name,sku,is_active)"
    )
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(pageSize + 1);

  if (status !== "all") {
    query = query.eq("is_active", status === "active");
  }
  const trimmedSearch = search.trim();
  if (trimmedSearch) {
    query = query.ilike("name", `%${trimmedSearch}%`);
  }
  if (cursor) {
    // Equivalente a `(name, id) > (cursor.name, cursor.id)` — orden
    // ascendente, así que acá es ">" en vez del "<" de getOrdersPage()
    // (que ordena descendente).
    query = query.or(`name.gt.${cursor.name},and(name.eq.${cursor.name},id.gt.${cursor.id})`);
  }

  const { data: fetched } = await query;
  const hasNextPage = (fetched?.length ?? 0) > pageSize;
  const products = (hasNextPage ? (fetched ?? []).slice(0, pageSize) : (fetched ?? [])) as unknown as ProductListRow[];

  const lastRow = products.at(-1);
  const nextCursor: ProductsPageCursor = lastRow && hasNextPage ? { name: lastRow.name, id: lastRow.id } : null;

  const pageVariantIds = products.flatMap((p) => p.product_variants.map((v) => v.id));
  const prices = await getPricesForVariants(pageVariantIds);

  return { products, nextCursor, prices };
}
