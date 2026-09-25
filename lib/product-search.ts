import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { VariantPrices } from "@/lib/order-pricing";

export type VariantSearchResult = { id: string; label: string; retailPrice: number };

const RETAIL_CODE = "retail";
export const MAX_SEARCH_RESULTS = 20;
export const MIN_SEARCH_CHARS = 2;

type RawVariantRow = {
  id: string;
  name: string;
  products: { name: string } | null;
  price_list_items: { unit_price: number }[] | null;
};

const SELECT_CLAUSE =
  "id,name,products!inner(name,is_active),price_list_items!inner(unit_price,price_lists!inner(code))";

function toVariantOption(row: RawVariantRow): VariantSearchResult | null {
  const productName = row.products?.name;
  const price = row.price_list_items?.[0]?.unit_price;
  if (!productName || price == null) return null;
  return {
    id: row.id,
    label: row.name === "Único" ? productName : `${productName} — ${row.name}`,
    retailPrice: price,
  };
}

export type SearchResult = { results: VariantSearchResult[] } | { error: true };

/**
 * Busca variantes activas con precio minorista cargado, por nombre de
 * producto O de variante — nunca descarga el catálogo entero (perf
 * audit H-08: a ~1.500+ variantes, el enfoque anterior — traer todo y
 * filtrar en memoria — rompía con HTTP 414 en la query de precios).
 * Dos queries en paralelo (coincidencia por producto, por variante) en
 * vez de un único `.or()` cruzando tablas embebidas — PostgREST no
 * soporta esa combinación directamente sobre columnas de un embed.
 * Nunca lanza: un fallo de red/RLS vuelve como `{ error: true }` para
 * que la UI lo distinga de "sin resultados" — un error de backend
 * nunca debe verse como catálogo vacío.
 */
export async function searchSaleVariants(query: string, client?: SupabaseClient): Promise<SearchResult> {
  const q = query.trim();
  if (q.length < MIN_SEARCH_CHARS) return { results: [] };

  // `client` sólo lo inyectan los tests de integración (el cliente de
  // navegador no existe fuera de un navegador); en la app siempre es el
  // de `@/lib/supabase/client`.
  const supabase = client ?? createClient();
  const pattern = `%${q}%`;

  const [byProduct, byVariant] = await Promise.all([
    supabase
      .from("product_variants")
      .select(SELECT_CLAUSE)
      .eq("is_active", true)
      .eq("products.is_active", true)
      .eq("price_list_items.price_lists.code", RETAIL_CODE)
      .ilike("products.name", pattern)
      .limit(MAX_SEARCH_RESULTS),
    supabase
      .from("product_variants")
      .select(SELECT_CLAUSE)
      .eq("is_active", true)
      .eq("products.is_active", true)
      .eq("price_list_items.price_lists.code", RETAIL_CODE)
      .ilike("name", pattern)
      .limit(MAX_SEARCH_RESULTS),
  ]);

  if (byProduct.error || byVariant.error) return { error: true };

  const merged = new Map<string, VariantSearchResult>();
  for (const raw of [...(byProduct.data ?? []), ...(byVariant.data ?? [])] as unknown as RawVariantRow[]) {
    const option = toVariantOption(raw);
    if (option && !merged.has(option.id)) merged.set(option.id, option);
  }
  return { results: [...merged.values()].slice(0, MAX_SEARCH_RESULTS) };
}

/**
 * Resuelve IDs puntuales (recientes/frecuentes, guardados en
 * localStorage) contra el catálogo actual. Nunca más de MAX_FREQUENT
 * (6) ids llegan acá, así que el `.in()` nunca corre el riesgo de URL
 * larga que sí tiene un `.in()` con cientos/miles de ids. Un id que ya
 * no existe, quedó inactivo, o perdió su precio minorista simplemente
 * no aparece en el resultado — nunca rompe la pantalla. El orden de
 * salida respeta el de `ids` (más frecuente primero), no el que
 * devuelva la base.
 */
export async function resolveSaleVariantsByIds(ids: string[]): Promise<VariantSearchResult[]> {
  if (ids.length === 0) return [];

  const supabase = createClient();
  const { data, error } = await supabase
    .from("product_variants")
    .select(SELECT_CLAUSE)
    .eq("is_active", true)
    .eq("products.is_active", true)
    .eq("price_list_items.price_lists.code", RETAIL_CODE)
    .in("id", ids);

  if (error || !data) return [];

  const byId = new Map<string, VariantSearchResult>();
  for (const raw of data as unknown as RawVariantRow[]) {
    const option = toVariantOption(raw);
    if (option) byId.set(option.id, option);
  }
  return ids.map((id) => byId.get(id)).filter((v): v is VariantSearchResult => Boolean(v));
}

// ---------------------------------------------------------------------------
// /pedidos/nuevo — búsqueda con precios de LAS DOS listas
// ---------------------------------------------------------------------------

/**
 * Variante para un pedido manual: trae el precio de la lista minorista Y de
 * la mayorista en la misma consulta, así cambiar la unidad de negocio del
 * pedido recalcula en el cliente sin volver a consultar (ni carreras).
 *
 * A diferencia de `searchSaleVariants` (venta rápida: sin precio minorista no
 * se vende), acá una variante SIN precio en alguna lista igual aparece — con
 * `null` en esa lista —: un pedido mayorista a medida puede necesitar una
 * variante que todavía no tiene precio mayorista, y la usuaria lo carga a
 * mano (el formulario se lo avisa). Nunca se oculta.
 */
export type OrderVariantResult = { id: string; label: string; prices: VariantPrices };

export type OrderSearchResult = { results: OrderVariantResult[] } | { error: true };

type RawOrderVariantRow = {
  id: string;
  name: string;
  products: { name: string } | null;
  price_list_items: { unit_price: number; price_lists: { code: string } | null }[] | null;
};

// Sin `!inner` sobre los precios: una variante sin precios sigue viniendo
// (con `price_list_items: []`). Las demás listas (condiciones restringidas
// de /precios) vienen también y se ignoran: sólo cuentan retail/wholesale.
const ORDER_SELECT_CLAUSE = "id,name,products!inner(name,is_active),price_list_items(unit_price,price_lists(code))";

function toOrderVariant(row: RawOrderVariantRow): OrderVariantResult | null {
  const productName = row.products?.name;
  if (!productName) return null;
  const priceIn = (code: string) => row.price_list_items?.find((p) => p.price_lists?.code === code)?.unit_price ?? null;
  return {
    id: row.id,
    label: row.name === "Único" ? productName : `${productName} — ${row.name}`,
    prices: { retail: priceIn("retail"), wholesale: priceIn("wholesale") },
  };
}

export async function searchOrderVariants(query: string, client?: SupabaseClient): Promise<OrderSearchResult> {
  const q = query.trim();
  if (q.length < MIN_SEARCH_CHARS) return { results: [] };

  const supabase = client ?? createClient();
  const pattern = `%${q}%`;

  const [byProduct, byVariant] = await Promise.all([
    supabase
      .from("product_variants")
      .select(ORDER_SELECT_CLAUSE)
      .eq("is_active", true)
      .eq("products.is_active", true)
      .ilike("products.name", pattern)
      .limit(MAX_SEARCH_RESULTS),
    supabase
      .from("product_variants")
      .select(ORDER_SELECT_CLAUSE)
      .eq("is_active", true)
      .eq("products.is_active", true)
      .ilike("name", pattern)
      .limit(MAX_SEARCH_RESULTS),
  ]);

  if (byProduct.error || byVariant.error) return { error: true };

  const merged = new Map<string, OrderVariantResult>();
  for (const raw of [...(byProduct.data ?? []), ...(byVariant.data ?? [])] as unknown as RawOrderVariantRow[]) {
    const option = toOrderVariant(raw);
    if (option && !merged.has(option.id)) merged.set(option.id, option);
  }
  return { results: [...merged.values()].slice(0, MAX_SEARCH_RESULTS) };
}
