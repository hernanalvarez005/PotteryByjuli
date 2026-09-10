import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Regression coverage for "productos inactivos fuera del catálogo
// mayorista" (auditoría previa a esta tanda): confirmado que la RLS ya
// bloquea esto correctamente hoy — este test existe para que un cambio
// futuro que rompa esa RLS (o el filtro de defensa en profundidad en
// lib/wholesale.ts) se note inmediatamente.
//
// A diferencia de wholesale-anon-access.integration.test.ts (sólo
// lectura, corre contra producción), este test necesita crear una
// combinación controlada de producto/variante activo/inactivo — así que
// corre EXCLUSIVAMENTE contra Supabase LOCAL (nunca producción, ni
// siquiera con datos de prueba limpiados después — misma política que el
// resto de esta sesión), usando el cliente admin para el setup/cleanup y
// el cliente anon para la verificación real.

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
// Only ever run against a local instance — an obviously-local URL is
// required, not just "credentials present", so this can never
// accidentally fire against a real project.
const isLocal = Boolean(SUPABASE_URL?.includes("127.0.0.1") || SUPABASE_URL?.includes("localhost"));
const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY && isLocal);

describe.skipIf(!hasCredentials)("wholesale catalog hides inactive products/variants (anon)", () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let categoryId: string;
  let activeProductId: string;
  let inactiveProductId: string;
  let mixedProductId: string;
  let mixedActiveVariantId: string;
  let mixedInactiveVariantId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    anon = createClient(SUPABASE_URL!, ANON_KEY!);

    const { data: category, error: catErr } = await admin
      .from("product_categories")
      .insert({ name: "Fixture activo/inactivo", code: `active-filter-test-${Date.now()}` })
      .select("id")
      .single();
    if (catErr) throw catErr;
    categoryId = category.id;

    const { data: priceList } = await admin.from("price_lists").select("id").eq("code", "wholesale").single();
    if (!priceList) throw new Error("no wholesale price list found locally");
    const wholesalePriceListId = priceList.id;

    async function makeProduct(name: string, isActive: boolean) {
      const { data: product, error } = await admin
        .from("products")
        .insert({ name, category_id: categoryId, is_active: isActive })
        .select("id")
        .single();
      if (error) throw error;
      const { data: variant } = await admin
        .from("product_variants")
        .select("id")
        .eq("product_id", product.id)
        .single();
      await admin
        .from("price_list_items")
        .insert({ price_list_id: wholesalePriceListId, product_variant_id: variant!.id, unit_price: 12345 });
      await admin.from("wholesale_product_rules").insert({ product_id: product.id, is_public: true, min_quantity: 1 });
      return { productId: product.id as string, variantId: variant!.id as string };
    }

    const active = await makeProduct("Fixture producto activo", true);
    activeProductId = active.productId;

    const inactive = await makeProduct("Fixture producto inactivo", false);
    inactiveProductId = inactive.productId;

    // Producto activo con dos variantes: A activa, B inactiva.
    const { data: mixedProduct, error: mixedErr } = await admin
      .from("products")
      .insert({ name: "Fixture variante mixta", category_id: categoryId, is_active: true })
      .select("id")
      .single();
    if (mixedErr) throw mixedErr;
    mixedProductId = mixedProduct.id;
    const { data: autoVariant } = await admin
      .from("product_variants")
      .select("id")
      .eq("product_id", mixedProductId)
      .single();
    mixedActiveVariantId = autoVariant!.id;
    const { data: extraVariant, error: extraErr } = await admin
      .from("product_variants")
      .insert({ product_id: mixedProductId, name: "Inactiva", is_active: false })
      .select("id")
      .single();
    if (extraErr) throw extraErr;
    mixedInactiveVariantId = extraVariant.id;

    await admin.from("price_list_items").insert([
      { price_list_id: wholesalePriceListId, product_variant_id: mixedActiveVariantId, unit_price: 11111 },
      { price_list_id: wholesalePriceListId, product_variant_id: mixedInactiveVariantId, unit_price: 22222 },
    ]);
    await admin.from("wholesale_product_rules").insert({ product_id: mixedProductId, is_public: true, min_quantity: 1 });
  });

  afterAll(async () => {
    for (const productId of [activeProductId, inactiveProductId, mixedProductId]) {
      await admin.from("price_list_items").delete().in(
        "product_variant_id",
        (await admin.from("product_variants").select("id").eq("product_id", productId)).data?.map((v) => v.id) ?? []
      );
      await admin.from("wholesale_product_rules").delete().eq("product_id", productId);
      await admin.from("products").delete().eq("id", productId); // cascades variants/images
    }
    await admin.from("product_categories").delete().eq("id", categoryId);
  });

  it("an active + public product is visible to anon", async () => {
    const { data } = await anon.from("products").select("id").eq("id", activeProductId);
    expect(data).toHaveLength(1);
  });

  it("an inactive product is never visible to anon, even though it's public/priced", async () => {
    const { data } = await anon.from("products").select("id").eq("id", inactiveProductId);
    expect(data).toHaveLength(0);
  });

  it("of two variants on an active product, only the active one is visible to anon", async () => {
    const { data } = await anon
      .from("product_variants")
      .select("id")
      .in("id", [mixedActiveVariantId, mixedInactiveVariantId]);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(mixedActiveVariantId);
  });

  it("the inactive variant's price row is not visible to anon either", async () => {
    const { data } = await anon
      .from("price_list_items")
      .select("product_variant_id")
      .eq("product_variant_id", mixedInactiveVariantId);
    expect(data).toHaveLength(0);
  });
});
