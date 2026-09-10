import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Ejercita,
// vía el cliente anon logueado como la owner de prueba (mismo camino RLS
// que usaría el server action real), exactamente lo que hace
// applyWholesalePriceToAllVariants: resolver price_lists por code
// ('wholesale'), resolver las variantes reales por productId, y upsert-ear
// todas con un único precio — sin que ningún id ajeno pueda colarse,
// porque el action nunca recibe variantId/priceListId del cliente.

function loadEnvLocal() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const envPath = path.resolve(__dirname, "..", "..", "..", "..", ".env.development.local");
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

/** Mirrors exactly what applyWholesalePriceToAllVariants does server-side,
 * using the owner-authenticated anon client (same RLS path the real
 * server action goes through) — never the client-supplied ids a caller
 * could otherwise try to smuggle in. */
async function applyAsTheActionWould(owner: SupabaseClient, productId: string, unitPrice: number) {
  const { data: wholesaleList, error: listError } = await owner
    .from("price_lists")
    .select("id")
    .eq("code", "wholesale")
    .maybeSingle();
  if (listError || !wholesaleList) throw listError ?? new Error("no wholesale list");

  const { data: variants, error: variantsError } = await owner
    .from("product_variants")
    .select("id")
    .eq("product_id", productId);
  if (variantsError) throw variantsError;

  const rows = (variants ?? []).map((v) => ({
    price_list_id: wholesaleList.id,
    product_variant_id: v.id,
    unit_price: unitPrice,
  }));
  return owner.from("price_list_items").upsert(rows, { onConflict: "price_list_id,product_variant_id" });
}

describe.skipIf(!hasCredentials)("applyWholesalePriceToAllVariants resolves ids server-side (local)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let categoryId: string;
  let wholesaleListId: string;
  let retailListId: string;

  async function makeProductWithVariants(name: string, variantNames: string[]) {
    const { data: product, error } = await admin
      .from("products")
      .insert({ name, category_id: categoryId, is_active: true })
      .select("id")
      .single();
    if (error) throw error;
    // Replace whatever default variant the insert trigger/seed convention
    // creates with exactly the variants this test wants, for predictable
    // counts.
    await admin.from("product_variants").delete().eq("product_id", product.id);
    const { data: variants, error: variantsError } = await admin
      .from("product_variants")
      .insert(variantNames.map((n) => ({ product_id: product.id, name: n })))
      .select("id,name");
    if (variantsError) throw variantsError;
    return { productId: product.id as string, variants: variants as { id: string; name: string }[] };
  }

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

    const { data: category, error: catErr } = await admin
      .from("product_categories")
      .insert({ name: "Bulk wholesale price test", code: `bulk-wholesale-test-${Date.now()}` })
      .select("id")
      .single();
    if (catErr) throw catErr;
    categoryId = category.id;

    const { data: wholesale } = await admin.from("price_lists").select("id").eq("code", "wholesale").single();
    wholesaleListId = wholesale!.id;
    const { data: retail } = await admin.from("price_lists").select("id").eq("code", "retail").single();
    retailListId = retail!.id;
  });

  afterAll(async () => {
    await admin.from("products").delete().eq("category_id", categoryId);
    await admin.from("product_categories").delete().eq("id", categoryId);
  });

  it("applies one price to every real variant of the product, overwrites differing prices, and never touches other products or the retail list", async () => {
    const target = await makeProductWithVariants("Target", ["Chica", "Mediana", "Grande"]);
    const other = await makeProductWithVariants("Other", ["Única"]);

    // An existing, differing wholesale price on one variant — proves the
    // bulk apply overwrites it, not just fills in blanks.
    await admin.from("price_list_items").insert({
      price_list_id: wholesaleListId,
      product_variant_id: target.variants[0].id,
      unit_price: 999,
    });
    // A retail price on that same variant must never be touched by a
    // wholesale bulk apply.
    await admin.from("price_list_items").insert({
      price_list_id: retailListId,
      product_variant_id: target.variants[0].id,
      unit_price: 5000,
    });

    const { error } = await applyAsTheActionWould(owner, target.productId, 1500);
    expect(error).toBeNull();

    const { data: targetPrices } = await admin
      .from("price_list_items")
      .select("product_variant_id,unit_price")
      .eq("price_list_id", wholesaleListId)
      .in("product_variant_id", target.variants.map((v) => v.id));
    expect(targetPrices).toHaveLength(3);
    for (const row of targetPrices ?? []) {
      expect(row.unit_price).toBe(1500);
    }

    const { data: retailPrice } = await admin
      .from("price_list_items")
      .select("unit_price")
      .eq("price_list_id", retailListId)
      .eq("product_variant_id", target.variants[0].id)
      .single();
    expect(retailPrice?.unit_price).toBe(5000);

    // The other product's variant never received a wholesale price — the
    // server-side re-derivation stayed scoped strictly to the target
    // product's own variants, never anything a caller could point at
    // through a manipulated id.
    const { data: otherPrices } = await admin
      .from("price_list_items")
      .select("id")
      .eq("price_list_id", wholesaleListId)
      .eq("product_variant_id", other.variants[0].id);
    expect(otherPrices).toHaveLength(0);
  });

  it("RLS blocks a non-owner from writing price_list_items even with real, known ids — the action's own owner check is defense in depth, not the only gate", async () => {
    const target = await makeProductWithVariants("Owner gate target", ["Única"]);
    const nonOwner = createClient(SUPABASE_URL!, ANON_KEY!); // no session (anon), never authenticated

    // Attempts the write directly with real ids (skipping the
    // re-derivation helper, which — for a product with no public wholesale
    // visibility — would itself see zero variants for anon and turn this
    // into a no-op that proves nothing). This isolates exactly the RLS
    // write policy on price_list_items.
    const { error } = await nonOwner.from("price_list_items").upsert(
      {
        price_list_id: wholesaleListId,
        product_variant_id: target.variants[0].id,
        unit_price: 1000,
      },
      { onConflict: "price_list_id,product_variant_id" }
    );
    expect(error).not.toBeNull();

    const { data: prices } = await admin
      .from("price_list_items")
      .select("id")
      .eq("price_list_id", wholesaleListId)
      .eq("product_variant_id", target.variants[0].id);
    expect(prices).toHaveLength(0);
  });
});
