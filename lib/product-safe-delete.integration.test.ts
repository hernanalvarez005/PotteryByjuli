import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción) — necesita
// crear/borrar productos, pedidos y clientes de prueba de verdad para
// probar delete_product_safe/classify_products_for_delete/
// bulk_delete_products_safe, algo que nunca se hace contra datos reales
// (misma política que el resto de esta sesión). Usa el cliente admin para
// el setup y un cliente anon logueado como el usuario owner de prueba
// (creado por scripts/create-local-test-owner o equivalente) para llamar
// las RPCs exactamente como las llamaría la app.

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

describe.skipIf(!hasCredentials)("delete_product_safe / bulk_delete_products_safe (local)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let categoryId: string;

  async function makeProduct(name: string) {
    const { data: product, error } = await admin
      .from("products")
      .insert({ name, category_id: categoryId, is_active: true })
      .select("id")
      .single();
    if (error) throw error;
    const { data: variant } = await admin
      .from("product_variants")
      .select("id")
      .eq("product_id", product.id)
      .single();
    return { productId: product.id as string, variantId: variant!.id as string };
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    owner = createClient(SUPABASE_URL!, ANON_KEY!);

    // Ensure a local owner test user exists (idempotent — reused across
    // this session's test files, created once via the Admin API).
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
      .insert({ name: "Safe delete test", code: `safe-delete-test-${Date.now()}` })
      .select("id")
      .single();
    if (catErr) throw catErr;
    categoryId = category.id;
  });

  afterAll(async () => {
    await admin.from("products").delete().eq("category_id", categoryId);
    await admin.from("product_categories").delete().eq("id", categoryId);
  });

  it("deletes a product with no history", async () => {
    const { productId } = await makeProduct("Sin historial");
    const { error } = await owner.rpc("delete_product_safe", { p_id: productId });
    expect(error).toBeNull();
    const { data } = await admin.from("products").select("id").eq("id", productId);
    expect(data).toHaveLength(0);
  });

  it("blocks deleting a product with a real order_item, with a specific message", async () => {
    const { productId, variantId } = await makeProduct("Con pedido");
    const { data: bu } = await admin.from("business_units").select("id").eq("code", "retail").single();
    const { data: customer } = await admin.from("customers").insert({ first_name: "Safe Delete Test" }).select("id").single();
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: bu!.id, customer_id: customer!.id })
      .select("id")
      .single();
    await admin.from("order_items").insert({ order_id: order!.id, product_variant_id: variantId, quantity: 1, unit_price: 100 });

    const { error } = await owner.rpc("delete_product_safe", { p_id: productId });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("1 venta(s)");
    const { data } = await admin.from("products").select("id").eq("id", productId);
    expect(data).toHaveLength(1); // still exists, untouched

    await admin.from("order_items").delete().eq("order_id", order!.id);
    await admin.from("orders").delete().eq("id", order!.id);
    await admin.from("customers").delete().eq("id", customer!.id);
    await admin.from("products").delete().eq("id", productId);
  });

  it("deletes a product that only has a stock_thresholds row (config, not history)", async () => {
    const { productId, variantId } = await makeProduct("Sólo umbral");
    const { data: invItem } = await admin.from("inventory_items").select("id").eq("product_variant_id", variantId).single();
    await admin.from("stock_thresholds").insert({ inventory_item_id: invItem!.id, min_quantity: 3 });

    const { error } = await owner.rpc("delete_product_safe", { p_id: productId });
    expect(error).toBeNull();
    const { data } = await admin.from("products").select("id").eq("id", productId);
    expect(data).toHaveLength(0);
  });

  it("classify_products_for_delete correctly reports a blocked product", async () => {
    const { productId, variantId } = await makeProduct("Para clasificar");
    const { data: bu } = await admin.from("business_units").select("id").eq("code", "retail").single();
    const { data: customer } = await admin.from("customers").insert({ first_name: "Classify Test" }).select("id").single();
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: bu!.id, customer_id: customer!.id })
      .select("id")
      .single();
    await admin.from("order_items").insert({ order_id: order!.id, product_variant_id: variantId, quantity: 2, unit_price: 50 });

    const { data, error } = await owner.rpc("classify_products_for_delete", { p_ids: [productId] });
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        product_id: productId,
        product_name: "Para clasificar",
        deletable: false,
        order_items_count: 1,
        movements_count: 0,
        production_orders_count: 0,
      },
    ]);

    await admin.from("order_items").delete().eq("order_id", order!.id);
    await admin.from("orders").delete().eq("id", order!.id);
    await admin.from("customers").delete().eq("id", customer!.id);
    await admin.from("products").delete().eq("id", productId);
  });

  it("bulk_delete_products_safe deletes eligible ids and deactivates blocked ones in one call, never a silent partial mix", async () => {
    const clean = await makeProduct("Bulk limpio");
    const withHistory = await makeProduct("Bulk con historial");
    const { data: bu } = await admin.from("business_units").select("id").eq("code", "retail").single();
    const { data: customer } = await admin.from("customers").insert({ first_name: "Bulk Test" }).select("id").single();
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: bu!.id, customer_id: customer!.id })
      .select("id")
      .single();
    await admin.from("order_items").insert({ order_id: order!.id, product_variant_id: withHistory.variantId, quantity: 1, unit_price: 10 });

    const { data, error } = await owner.rpc("bulk_delete_products_safe", {
      p_ids: [clean.productId, withHistory.productId],
    });
    expect(error).toBeNull();
    const row = (data as { deleted_ids: string[]; deactivated_ids: string[] }[])[0];
    expect(row.deleted_ids).toEqual([clean.productId]);
    expect(row.deactivated_ids).toEqual([withHistory.productId]);

    const { data: cleanRow } = await admin.from("products").select("id").eq("id", clean.productId);
    expect(cleanRow).toHaveLength(0);
    const { data: historyRow } = await admin.from("products").select("is_active").eq("id", withHistory.productId).single();
    expect(historyRow?.is_active).toBe(false);

    await admin.from("order_items").delete().eq("order_id", order!.id);
    await admin.from("orders").delete().eq("id", order!.id);
    await admin.from("customers").delete().eq("id", customer!.id);
    await admin.from("products").delete().eq("id", withHistory.productId);
  });

  it("a non-owner cannot delete a product, even with no history", async () => {
    // Confirms the RPC's own is_owner() gate — never just a hidden button.
    const nonOwner = createClient(SUPABASE_URL!, ANON_KEY!);
    const { productId } = await makeProduct("Owner gate test");
    const { error } = await nonOwner.rpc("delete_product_safe", { p_id: productId }); // no session at all (anon)
    expect(error).not.toBeNull();
    const { data } = await admin.from("products").select("id").eq("id", productId);
    expect(data).toHaveLength(1);
    await admin.from("products").delete().eq("id", productId);
  });
});
