import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Bloquea
// el bug real reportado en la tanda de usabilidad (2026-09-11, ítems
// 23-26): "algunos productos/modelos toman correctamente el precio
// mayorista y otros no, incluso después de cargar valores."
//
// Causa raíz encontrada en lib/wholesale.ts (getWholesaleCatalog): la
// query a price_list_items nunca filtraba por price_list_id — traía
// TANTO la fila minorista como la mayorista de cada variante, y un
// `Map` keyeado por product_variant_id se quedaba con lo último que
// Postgres devolviera, un orden que la query nunca fijó. Cuál precio
// ganaba (minorista o mayorista) dependía de un detalle interno de
// Postgres sin ninguna relación con "hay o no hay precio mayorista
// cargado" — exactamente el síntoma reportado.
//
// Este test inserta AMBAS filas (retail y wholesale) para la misma
// variante, en los dos órdenes de inserción posibles, y confirma que la
// query real (mirror exacto de getWholesaleCatalog tras el fix) siempre
// devuelve el precio mayorista — nunca el minorista, sin importar el
// orden de inserción.

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

/** Mirrors exactly the fixed price resolution in getWholesaleCatalog
 * (lib/wholesale.ts): resolve the wholesale price_list_id first, then
 * filter price_list_items by it explicitly — never build a Map from an
 * unfiltered set that could contain both a retail and a wholesale row
 * for the same variant. */
async function resolveWholesalePrice(admin: SupabaseClient, variantId: string): Promise<number | undefined> {
  const { data: wholesaleList } = await admin.from("price_lists").select("id").eq("code", "wholesale").single();
  const { data: rows } = await admin
    .from("price_list_items")
    .select("product_variant_id,unit_price")
    .eq("price_list_id", wholesaleList!.id)
    .in("product_variant_id", [variantId]);
  const byVariant = new Map((rows ?? []).map((r) => [r.product_variant_id, r.unit_price]));
  return byVariant.get(variantId);
}

describe.skipIf(!hasCredentials)("/mayorista price resolution never falls back to retail (local)", () => {
  let admin: SupabaseClient;
  let categoryId: string;
  let retailListId: string;
  let wholesaleListId: string;
  const productIds: string[] = [];

  async function makeVariantWithBothPrices(name: string, retailPrice: number, wholesalePrice: number, insertWholesaleFirst: boolean) {
    const { data: product } = await admin
      .from("products")
      .insert({ name, category_id: categoryId, is_active: true })
      .select("id")
      .single();
    productIds.push(product!.id);
    const { data: variant } = await admin.from("product_variants").select("id").eq("product_id", product!.id).single();
    const variantId = variant!.id as string;

    const retailRow = { price_list_id: retailListId, product_variant_id: variantId, unit_price: retailPrice };
    const wholesaleRow = { price_list_id: wholesaleListId, product_variant_id: variantId, unit_price: wholesalePrice };
    const rows = insertWholesaleFirst ? [wholesaleRow, retailRow] : [retailRow, wholesaleRow];
    // Insertadas una por una, en el orden pedido — para reproducir
    // fielmente "cuál fila quedó cargada más reciente en la tabla",
    // que es justo lo que el bug dejaba decidir el resultado.
    for (const row of rows) {
      await admin.from("price_list_items").insert(row);
    }
    return variantId;
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: category } = await admin
      .from("product_categories")
      .insert({ name: "Wholesale price test", code: `wholesale-price-test-${Date.now()}` })
      .select("id")
      .single();
    categoryId = category!.id;
    const { data: retailList } = await admin.from("price_lists").select("id").eq("code", "retail").single();
    retailListId = retailList!.id;
    const { data: wholesaleList } = await admin.from("price_lists").select("id").eq("code", "wholesale").single();
    wholesaleListId = wholesaleList!.id;
  });

  afterAll(async () => {
    await admin.from("products").delete().in("id", productIds);
    await admin.from("product_categories").delete().eq("id", categoryId);
  });

  it("uses the wholesale price when the wholesale row was inserted BEFORE the retail row", async () => {
    const variantId = await makeVariantWithBothPrices("Wholesale-first fixture", 24000, 18000, true);
    const resolved = await resolveWholesalePrice(admin, variantId);
    expect(resolved).toBe(18000);
    expect(resolved).not.toBe(24000);
  });

  it("uses the wholesale price when the retail row was inserted BEFORE the wholesale row — the exact case the bug got wrong", async () => {
    const variantId = await makeVariantWithBothPrices("Retail-first fixture", 24000, 18000, false);
    const resolved = await resolveWholesalePrice(admin, variantId);
    expect(resolved).toBe(18000);
    expect(resolved).not.toBe(24000);
  });
});
