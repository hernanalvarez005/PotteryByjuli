import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Prueba
// lo que hace getProductsPage() (lib/products.ts, perf audit H-08
// bloque 4) — createClient() ahí usa cookies() (next/headers), así que
// se replica la MISMA query contra supabase-js "plano" (mismo patrón
// que el resto de tests de integración de esta sesión).
//
// El dataset local ya tiene 3.265 productos reales (2.800 con el
// prefijo "Perf Fixture Producto N" de sesiones anteriores) — cada test
// de paginación/cursor usa `search` para acotarse SÓLO a sus propios
// fixtures (prefijo único), evitando el problema de contaminación por
// datos ambiente ya documentado en orders-pagination.integration.test.ts.

function loadEnvLocal() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const envPath = path.resolve(__dirname, "..", ".env.development.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isLocal = Boolean(SUPABASE_URL?.includes("127.0.0.1") || SUPABASE_URL?.includes("localhost"));
const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY && isLocal);

type Cursor = { name: string; id: string } | null;
type StatusFilter = "all" | "active" | "inactive";

/** Misma query que getProductsPage() (lib/products.ts). */
async function fetchProductsPage(
  client: SupabaseClient,
  status: StatusFilter,
  search: string,
  cursor: Cursor,
  pageSize: number
) {
  let query = client
    .from("products")
    .select(
      "id,name,description,cost_estimate,is_active,category_id,product_categories(name),product_variants(id,name,sku,is_active)"
    )
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(pageSize + 1);

  if (status !== "all") query = query.eq("is_active", status === "active");
  const trimmed = search.trim();
  if (trimmed) query = query.ilike("name", `%${trimmed}%`);
  if (cursor) query = query.or(`name.gt.${cursor.name},and(name.eq.${cursor.name},id.gt.${cursor.id})`);

  const { data, error } = await query;
  if (error) throw error;
  const fetched = data ?? [];
  const hasNextPage = fetched.length > pageSize;
  const products = (hasNextPage ? fetched.slice(0, pageSize) : fetched) as unknown as {
    id: string;
    name: string;
    is_active: boolean;
    product_variants: { id: string }[];
  }[];

  const variantIds = products.flatMap((p) => p.product_variants.map((v) => v.id));
  const { data: priceRowsRaw, error: priceErr } = variantIds.length
    ? await client.from("price_list_items").select("product_variant_id,unit_price,price_lists(code)").in("product_variant_id", variantIds)
    : { data: [], error: null };
  if (priceErr) throw priceErr;
  const priceRows = (priceRowsRaw ?? []) as unknown as {
    product_variant_id: string;
    unit_price: number;
    price_lists: { code: string } | null;
  }[];

  const prices: Record<string, { retail?: number; wholesale?: number }> = {};
  for (const row of priceRows) {
    const code = row.price_lists?.code;
    if (code !== "retail" && code !== "wholesale") continue;
    prices[row.product_variant_id] ??= {};
    prices[row.product_variant_id][code] = row.unit_price;
  }

  const last = products.at(-1);
  const nextCursor: Cursor = last && hasNextPage ? { name: last.name, id: last.id } : null;
  return { products, prices, nextCursor };
}

describe.skipIf(!hasCredentials)("getProductsPage keyset pagination + precios acotados (local)", () => {
  let admin: SupabaseClient;
  let retailListId: string;
  const FIXTURE_PREFIX = "Products Page Fixture";
  const FIXTURE_COUNT = 25;
  const fixtureProductIds: string[] = [];
  const fixtureVariantIds: string[] = [];
  let inactiveProductId: string;
  let noPriceVariantId: string;
  let pricedVariantId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    const { data: retailList } = await admin.from("price_lists").select("id").eq("code", "retail").single();
    retailListId = retailList!.id;

    for (let i = 1; i <= FIXTURE_COUNT; i++) {
      const name = `${FIXTURE_PREFIX} ${String(i).padStart(3, "0")}`;
      const { data: product } = await admin
        .from("products")
        .insert({ name, is_active: true })
        .select("id")
        .single();
      fixtureProductIds.push(product!.id);

      const { data: variant } = await admin
        .from("product_variants")
        .insert({ product_id: product!.id, name: "Única", is_active: true })
        .select("id")
        .single();
      fixtureVariantIds.push(variant!.id);

      // Sólo la primera variante tiene precio cargado — el resto queda
      // sin precio a propósito, para confirmar que eso nunca rompe nada.
      if (i === 1) {
        pricedVariantId = variant!.id;
        await admin.from("price_list_items").insert({
          price_list_id: retailListId,
          product_variant_id: variant!.id,
          unit_price: 1234,
        });
      } else if (i === 2) {
        noPriceVariantId = variant!.id;
      }
    }

    // Un producto inactivo con el mismo prefijo — nunca debe aparecer
    // con status='active', sí con 'all'/'inactive'.
    const { data: inactive } = await admin
      .from("products")
      .insert({ name: `${FIXTURE_PREFIX} Inactivo`, is_active: false })
      .select("id")
      .single();
    inactiveProductId = inactive!.id;
    fixtureProductIds.push(inactiveProductId);
  }, 30000);

  afterAll(async () => {
    // Nunca por lista de ids larga (mismo riesgo de HTTP 414 documentado
    // en toda la sesión) — se borra por el prefijo de nombre, un único
    // marcador que cubre todo el fixture sin importar cuántas filas sean.
    await admin.from("products").delete().ilike("name", `${FIXTURE_PREFIX}%`);
  }, 30000);

  it("pagina sin saltear ni repetir productos usando el cursor compuesto (name,id)", async () => {
    const page1 = await fetchProductsPage(admin, "active", FIXTURE_PREFIX, null, 10);
    expect(page1.products).toHaveLength(10);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await fetchProductsPage(admin, "active", FIXTURE_PREFIX, page1.nextCursor, 10);
    expect(page2.products).toHaveLength(10);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await fetchProductsPage(admin, "active", FIXTURE_PREFIX, page2.nextCursor, 10);
    expect(page3.products).toHaveLength(5); // 25 activos totales: 10+10+5
    expect(page3.nextCursor).toBeNull(); // última página real de un universo acotado por el prefijo

    const allIds = [...page1.products, ...page2.products, ...page3.products].map((p) => p.id);
    expect(new Set(allIds).size).toBe(25); // sin duplicados
    expect(allIds.filter((id) => fixtureProductIds.slice(0, 25).includes(id))).toHaveLength(25); // sin faltantes
  });

  it("status='active' excluye el producto inactivo; status='all' lo incluye", async () => {
    const activePage = await fetchProductsPage(admin, "active", FIXTURE_PREFIX, null, 100);
    expect(activePage.products.some((p) => p.id === inactiveProductId)).toBe(false);

    const allPage = await fetchProductsPage(admin, "all", FIXTURE_PREFIX, null, 100);
    expect(allPage.products.some((p) => p.id === inactiveProductId)).toBe(true);
  });

  it("los precios de la página cubren sólo las variantes mostradas, nunca todo el catálogo", async () => {
    const page1 = await fetchProductsPage(admin, "active", FIXTURE_PREFIX, null, 10);
    expect(page1.prices[pricedVariantId]).toEqual({ retail: 1234 });
    // Una variante real de OTRA sesión (fuera de este fixture) nunca
    // puede aparecer acá — la query nunca pide el catálogo completo.
    const realVariantIds = Object.keys(page1.prices);
    expect(realVariantIds.every((id) => fixtureVariantIds.includes(id))).toBe(true);
  });

  it("un producto sin precio cargado nunca rompe la resolución — simplemente no aparece en prices", async () => {
    const page1 = await fetchProductsPage(admin, "active", FIXTURE_PREFIX, null, 10);
    expect(page1.prices[noPriceVariantId]).toBeUndefined();
  });

  it("la búsqueda encuentra un producto más allá de la fila 1000 (orden alfabético), donde la lista sin acotar lo dejaba afuera", async () => {
    // "Perf Fixture Producto 2102" está en la posición ~1500 del orden
    // alfabético de products.name entre los 3.265 productos activos
    // reales — más allá del tope de 1.000 filas de PostgREST. La lista
    // vieja (sin filtro, sin .range()) nunca lo hubiera devuelto.
    const found = await fetchProductsPage(admin, "active", "Perf Fixture Producto 2102", null, 10);
    expect(found.products).toHaveLength(1);
    expect(found.products[0].name).toBe("Perf Fixture Producto 2102");

    // La query "vieja" (equivalente a getProductsWithVariants: sin
    // ilike, sin .range()) tapa en 1.000 filas — confirmamos que ese
    // producto específico no está entre ellas.
    const { data: unboundedList } = await admin
      .from("products")
      .select("id,name")
      .eq("is_active", true)
      .order("name", { ascending: true });
    expect((unboundedList ?? []).length).toBeLessThanOrEqual(1000);
    expect((unboundedList ?? []).some((p) => p.name === "Perf Fixture Producto 2102")).toBe(false);
  });
});
