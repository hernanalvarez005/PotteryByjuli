import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Prueba
// la MISMA forma de query que product-search.ts usa desde el cliente
// (@/lib/supabase/client no se puede importar acá — createBrowserClient
// necesita un entorno de navegador que vitest no provee — así que se
// replica la query exacta contra supabase-js "plano", igual que el resto
// de los tests de integración de este repo mirror-ean Server
// Components/Client Components). El dataset local ya trae 2.800+
// productos "Perf Fixture Producto N" (generados para medir H-08) — se
// reusan acá para probar contra un catálogo genuinamente grande, sin
// necesidad de generar más.

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

const OWNER_EMAIL = "owner-test@pottery.local";
const OWNER_PASSWORD = "test-password-123";

const SELECT_CLAUSE =
  "id,name,products!inner(name,is_active),price_list_items!inner(unit_price,price_lists!inner(code))";
const MAX_RESULTS = 20;

type RawRow = {
  id: string;
  name: string;
  products: { name: string } | null;
  price_list_items: { unit_price: number }[] | null;
};

function toLabel(row: RawRow): string | null {
  const productName = row.products?.name;
  const price = row.price_list_items?.[0]?.unit_price;
  if (!productName || price == null) return null;
  return row.name === "Único" ? productName : `${productName} — ${row.name}`;
}

/** Misma query que searchSaleVariants() (product-search.ts) — dos
 * consultas en paralelo, mergeadas y dedupeadas, nunca un .in() con
 * cientos/miles de ids. */
async function searchVariants(client: SupabaseClient, query: string) {
  const pattern = `%${query}%`;
  const [byProduct, byVariant] = await Promise.all([
    client
      .from("product_variants")
      .select(SELECT_CLAUSE)
      .eq("is_active", true)
      .eq("products.is_active", true)
      .eq("price_list_items.price_lists.code", "retail")
      .ilike("products.name", pattern)
      .limit(MAX_RESULTS),
    client
      .from("product_variants")
      .select(SELECT_CLAUSE)
      .eq("is_active", true)
      .eq("products.is_active", true)
      .eq("price_list_items.price_lists.code", "retail")
      .ilike("name", pattern)
      .limit(MAX_RESULTS),
  ]);
  if (byProduct.error) throw byProduct.error;
  if (byVariant.error) throw byVariant.error;

  const merged = new Map<string, RawRow>();
  for (const raw of [...(byProduct.data ?? []), ...(byVariant.data ?? [])] as unknown as RawRow[]) {
    if (!merged.has(raw.id)) merged.set(raw.id, raw);
  }
  return [...merged.values()].slice(0, MAX_RESULTS);
}

/** Misma query que resolveSaleVariantsByIds() (product-search.ts). */
async function resolveByIds(client: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from("product_variants")
    .select(SELECT_CLAUSE)
    .eq("is_active", true)
    .eq("products.is_active", true)
    .eq("price_list_items.price_lists.code", "retail")
    .in("id", ids);
  if (error) throw error;
  return (data ?? []) as unknown as RawRow[];
}

describe.skipIf(!hasCredentials)("sale variant search (local)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let categoryId: string;
  let retailListId: string;
  let noPriceProductId: string;
  let inactiveProductId: string;
  let variantNameMatchProductId: string;
  let inactiveVariantProductId: string;
  const cleanupProductIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    owner = createClient(SUPABASE_URL!, ANON_KEY!);

    const { data: existing } = await admin.auth.admin.listUsers();
    let ownerId = existing.users.find((u) => u.email === OWNER_EMAIL)?.id;
    if (!ownerId) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      ownerId = created.user!.id;
      await admin.from("user_roles").insert({ user_id: ownerId, role: "owner" });
    }
    const { error: signInErr } = await owner.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    if (signInErr) throw signInErr;

    const { data: category } = await admin.from("product_categories").select("id").limit(1).single();
    categoryId = category!.id;
    const { data: priceList } = await admin.from("price_lists").select("id").eq("code", "retail").single();
    retailListId = priceList!.id;

    // Producto activo, variante activa, SIN precio minorista cargado —
    // no debe aparecer nunca, aunque el nombre matchee.
    const { data: noPriceProduct } = await admin
      .from("products")
      .insert({ name: "Search Fixture Sin Precio Unico Xyzabc", category_id: categoryId, is_active: true })
      .select("id")
      .single();
    noPriceProductId = noPriceProduct!.id;
    cleanupProductIds.push(noPriceProductId);

    // Producto INACTIVO con precio cargado — no debe aparecer.
    const { data: inactiveProduct } = await admin
      .from("products")
      .insert({ name: "Search Fixture Inactivo Unico Xyzabc", category_id: categoryId, is_active: false })
      .select("id")
      .single();
    inactiveProductId = inactiveProduct!.id;
    cleanupProductIds.push(inactiveProductId);
    const { data: inactiveVariant } = await admin
      .from("product_variants")
      .select("id")
      .eq("product_id", inactiveProductId)
      .single();
    await admin.from("price_list_items").insert({
      price_list_id: retailListId,
      product_variant_id: inactiveVariant!.id,
      unit_price: 1000,
    });

    // Producto cuyo NOMBRE no matchea el término, pero una de sus
    // variantes sí — prueba la búsqueda por nombre de variante.
    const { data: variantMatchProduct } = await admin
      .from("products")
      .insert({ name: "Search Fixture Generico", category_id: categoryId, is_active: true })
      .select("id")
      .single();
    variantNameMatchProductId = variantMatchProduct!.id;
    cleanupProductIds.push(variantNameMatchProductId);
    const { data: extraVariant } = await admin
      .from("product_variants")
      .insert({ product_id: variantNameMatchProductId, name: "TerminoRaroUnicoXyz", is_active: true })
      .select("id")
      .single();
    await admin.from("price_list_items").insert({
      price_list_id: retailListId,
      product_variant_id: extraVariant!.id,
      unit_price: 2500,
    });

    // Producto activo con una variante ACTIVA (con precio) y otra
    // INACTIVA (también con precio, a propósito) — sólo la activa debe
    // aparecer al buscar por su propio nombre de variante.
    const { data: mixedProduct } = await admin
      .from("products")
      .insert({ name: "Search Fixture Mixto", category_id: categoryId, is_active: true })
      .select("id")
      .single();
    inactiveVariantProductId = mixedProduct!.id;
    cleanupProductIds.push(inactiveVariantProductId);
    const { data: disabledVariant } = await admin
      .from("product_variants")
      .insert({ product_id: inactiveVariantProductId, name: "VarianteDeshabilitadaXyz", is_active: false })
      .select("id")
      .single();
    await admin.from("price_list_items").insert({
      price_list_id: retailListId,
      product_variant_id: disabledVariant!.id,
      unit_price: 3000,
    });
  });

  afterAll(async () => {
    await admin.from("price_list_items").delete().in(
      "product_variant_id",
      (await admin.from("product_variants").select("id").in("product_id", cleanupProductIds)).data?.map((v) => v.id) ?? []
    );
    await admin.from("products").delete().in("id", cleanupProductIds);
  });

  it("el catálogo local supera 3.000 variantes — el escenario real que rompía antes", async () => {
    const { count } = await admin.from("product_variants").select("id", { count: "exact", head: true });
    expect(count).toBeGreaterThan(3000);
  });

  it("encuentra un producto 'Perf Fixture' del dataset masivo, sin romper con HTTP 414", async () => {
    const results = await searchVariants(owner, "Perf Fixture Producto 7");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => toLabel(r)?.includes("Perf Fixture Producto 7"))).toBe(true);
  });

  it("nunca devuelve más de 20 resultados, aunque miles de filas matcheen", async () => {
    const results = await searchVariants(owner, "fixture");
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it("busca por nombre de VARIANTE, no sólo de producto", async () => {
    const results = await searchVariants(owner, "TerminoRaroUnicoXyz");
    expect(results.some((r) => r.id && toLabel(r)?.includes("TerminoRaroUnicoXyz"))).toBe(true);
  });

  it("un producto sin precio minorista cargado nunca aparece", async () => {
    const results = await searchVariants(owner, "Sin Precio Unico Xyzabc");
    expect(results).toHaveLength(0);
  });

  it("un producto inactivo nunca aparece, aunque tenga precio cargado", async () => {
    const results = await searchVariants(owner, "Inactivo Unico Xyzabc");
    expect(results).toHaveLength(0);
  });

  it("una variante inactiva de un producto activo nunca aparece", async () => {
    const results = await searchVariants(owner, "VarianteDeshabilitadaXyz");
    expect(results).toHaveLength(0);
  });

  describe("resolveSaleVariantsByIds (recientes/frecuentes)", () => {
    it("ids inexistentes/inactivos/sin precio mezclados con uno válido no rompen — sólo se ignoran", async () => {
      const { data: validVariant } = await admin
        .from("product_variants")
        .select("id")
        .eq("product_id", variantNameMatchProductId)
        .neq("name", "Único")
        .single();

      const { data: inactiveVariantRow } = await admin
        .from("product_variants")
        .select("id")
        .eq("product_id", inactiveProductId)
        .single();

      const nonexistentId = "00000000-0000-4000-8000-000000000000";

      const results = await resolveByIds(owner, [validVariant!.id, nonexistentId, inactiveVariantRow!.id]);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(validVariant!.id);
    });

    it("una lista vacía de ids nunca dispara una query", async () => {
      const results = await resolveByIds(owner, []);
      expect(results).toEqual([]);
    });
  });
});
