import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Regression coverage for la sección 5 de la tanda de mejoras operativas
// (imágenes ↔ variantes): product_images_select_public_wholesale ahora
// también exige que, si la imagen está atada a una variante, esa variante
// esté activa. El cambio sólo achica acceso — este test confirma tanto el
// caso nuevo (oculto) como que todo lo que ya era visible antes lo sigue
// siendo (imagen general, imagen de variante activa).
//
// Corre exclusivamente contra Supabase LOCAL (nunca producción), misma
// política que el resto de esta tanda — necesita una combinación
// controlada de imágenes/variantes activas e inactivas.

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

describe.skipIf(!hasCredentials)("wholesale catalog hides images tied to an inactive variant (anon)", () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let categoryId: string;
  let productId: string;
  let activeVariantId: string;
  let inactiveVariantId: string;
  let generalImageId: string;
  let activeVariantImageId: string;
  let inactiveVariantImageId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    anon = createClient(SUPABASE_URL!, ANON_KEY!);

    const { data: category, error: catErr } = await admin
      .from("product_categories")
      .insert({ name: "Fixture imagen/variante", code: `image-variant-filter-test-${Date.now()}` })
      .select("id")
      .single();
    if (catErr) throw catErr;
    categoryId = category.id;

    const { data: priceList } = await admin.from("price_lists").select("id").eq("code", "wholesale").single();
    const wholesalePriceListId = priceList!.id;

    const { data: product, error: prodErr } = await admin
      .from("products")
      .insert({ name: "Fixture imagen/variante", category_id: categoryId, is_active: true })
      .select("id")
      .single();
    if (prodErr) throw prodErr;
    productId = product.id;

    const { data: autoVariant } = await admin
      .from("product_variants")
      .select("id")
      .eq("product_id", productId)
      .single();
    activeVariantId = autoVariant!.id;

    const { data: extraVariant, error: extraErr } = await admin
      .from("product_variants")
      .insert({ product_id: productId, name: "Inactiva", is_active: false })
      .select("id")
      .single();
    if (extraErr) throw extraErr;
    inactiveVariantId = extraVariant.id;

    await admin.from("price_list_items").insert([
      { price_list_id: wholesalePriceListId, product_variant_id: activeVariantId, unit_price: 11111 },
      { price_list_id: wholesalePriceListId, product_variant_id: inactiveVariantId, unit_price: 22222 },
    ]);
    await admin.from("wholesale_product_rules").insert({ product_id: productId, is_public: true, min_quantity: 1 });

    const { data: generalImage, error: generalErr } = await admin
      .from("product_images")
      .insert({ product_id: productId, storage_path: "fixture/general.jpg", variant_id: null, is_primary: true })
      .select("id")
      .single();
    if (generalErr) throw generalErr;
    generalImageId = generalImage.id;

    const { data: activeVariantImage, error: activeImgErr } = await admin
      .from("product_images")
      .insert({ product_id: productId, storage_path: "fixture/activa.jpg", variant_id: activeVariantId })
      .select("id")
      .single();
    if (activeImgErr) throw activeImgErr;
    activeVariantImageId = activeVariantImage.id;

    const { data: inactiveVariantImage, error: inactiveImgErr } = await admin
      .from("product_images")
      .insert({ product_id: productId, storage_path: "fixture/inactiva.jpg", variant_id: inactiveVariantId })
      .select("id")
      .single();
    if (inactiveImgErr) throw inactiveImgErr;
    inactiveVariantImageId = inactiveVariantImage.id;
  });

  afterAll(async () => {
    await admin.from("product_images").delete().eq("product_id", productId);
    await admin.from("price_list_items").delete().in("product_variant_id", [activeVariantId, inactiveVariantId]);
    await admin.from("wholesale_product_rules").delete().eq("product_id", productId);
    await admin.from("products").delete().eq("id", productId);
    await admin.from("product_categories").delete().eq("id", categoryId);
  });

  it("a general image (variant_id null) stays visible — nothing that was visible before is now hidden", async () => {
    const { data } = await anon.from("product_images").select("id").eq("id", generalImageId);
    expect(data).toHaveLength(1);
  });

  it("an image tied to an active variant stays visible", async () => {
    const { data } = await anon.from("product_images").select("id").eq("id", activeVariantImageId);
    expect(data).toHaveLength(1);
  });

  it("an image tied to an inactive variant is now hidden from anon — the new, tightened case", async () => {
    const { data } = await anon.from("product_images").select("id").eq("id", inactiveVariantImageId);
    expect(data).toHaveLength(0);
  });
});
