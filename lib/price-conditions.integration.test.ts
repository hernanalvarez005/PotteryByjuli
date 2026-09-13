import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre el
// motor de cotización del Bloque 3 ("Próxima evolución operativa de
// Pottery"): quote_retail_sale (sólo lectura, nunca inventa un precio) y
// create_price_condition (alta atómica de price_list + condición +
// métodos de pago aceptados).

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

type QuoteRow = { price_condition_id: string; price_condition_name: string; subtotal: number; adjustments: number; total: number };

describe.skipIf(!hasCredentials)("price conditions + quote_retail_sale (local)", () => {
  let admin: SupabaseClient;
  let categoryId: string;
  let variantId: string;
  let generalConditionId: string;
  const createdProductIds: string[] = [];
  const createdConditionIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    const { data: category } = await admin
      .from("product_categories")
      .insert({ name: "Price condition test", code: `price-condition-test-${Date.now()}` })
      .select("id")
      .single();
    categoryId = category!.id;

    const { data: product } = await admin
      .from("products")
      .insert({ name: "Quote engine fixture", category_id: categoryId, is_active: true })
      .select("id")
      .single();
    createdProductIds.push(product!.id);
    const { data: variant } = await admin.from("product_variants").select("id").eq("product_id", product!.id).single();
    variantId = variant!.id;

    const { data: retailList } = await admin.from("price_lists").select("id").eq("code", "retail").single();
    await admin.from("price_list_items").insert({ price_list_id: retailList!.id, product_variant_id: variantId, unit_price: 1000 });

    const { data: generalCondition } = await admin.from("price_conditions").select("id").eq("code", "general").single();
    generalConditionId = generalCondition!.id;
  });

  afterAll(async () => {
    await admin.from("price_conditions").delete().in("id", createdConditionIds);
    await admin.from("products").delete().in("id", createdProductIds);
    await admin.from("product_categories").delete().eq("id", categoryId);
  });

  it("quote_retail_sale returns the seeded 'general' condition with the real price_list_items total", async () => {
    const { data, error } = await admin.rpc("quote_retail_sale", {
      p_items: [{ product_variant_id: variantId, quantity: 3 }],
    });
    expect(error).toBeNull();
    const rows = data as QuoteRow[];
    const general = rows.find((r) => r.price_condition_id === generalConditionId);
    expect(general).toBeDefined();
    expect(general!.total).toBe(3000);
    expect(general!.adjustments).toBe(0);
  });

  it("excludes a condition entirely when it has no price for one of the cart's items — never invents a price or fails the whole quote", async () => {
    const { data: newConditionId } = await admin.rpc("create_price_condition", {
      p_code: `no-price-${Date.now()}`,
      p_name: "Sin precio (test)",
      p_payment_method_ids: [],
    });
    createdConditionIds.push(newConditionId as string);
    // A propósito: nunca se le carga un price_list_items para esta variante.

    const { data, error } = await admin.rpc("quote_retail_sale", {
      p_items: [{ product_variant_id: variantId, quantity: 1 }],
    });
    expect(error).toBeNull();
    const rows = data as QuoteRow[];
    expect(rows.some((r) => r.price_condition_id === newConditionId)).toBe(false);
    // La condición 'general', que sí tiene precio, sigue apareciendo —
    // una condición sin precio nunca tira abajo toda la cotización.
    expect(rows.some((r) => r.price_condition_id === generalConditionId)).toBe(true);
  });

  it("excludes an inactive condition even if it does have a price loaded", async () => {
    const { data: newConditionId } = await admin.rpc("create_price_condition", {
      p_code: `inactive-quote-${Date.now()}`,
      p_name: "Inactiva con precio (test)",
      p_payment_method_ids: [],
    });
    createdConditionIds.push(newConditionId as string);
    const { data: condition } = await admin.from("price_conditions").select("price_list_id").eq("id", newConditionId).single();
    await admin.from("price_list_items").insert({ price_list_id: condition!.price_list_id, product_variant_id: variantId, unit_price: 500 });
    await admin.from("price_conditions").update({ is_active: false }).eq("id", newConditionId);

    const { data, error } = await admin.rpc("quote_retail_sale", { p_items: [{ product_variant_id: variantId, quantity: 1 }] });
    expect(error).toBeNull();
    expect((data as QuoteRow[]).some((r) => r.price_condition_id === newConditionId)).toBe(false);
  });

  it("returns nothing for an empty cart — never a condition with a zero total", async () => {
    const { data, error } = await admin.rpc("quote_retail_sale", { p_items: [] });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("create_price_condition creates the price_list, the condition and its payment methods atomically", async () => {
    const { data: cash } = await admin.from("payment_methods").select("id").eq("code", "cash").single();
    const code = `atomic-test-${Date.now()}`;
    const { data: conditionId, error } = await admin.rpc("create_price_condition", {
      p_code: code,
      p_name: "Atómica (test)",
      p_payment_method_ids: [cash!.id],
    });
    expect(error).toBeNull();
    createdConditionIds.push(conditionId as string);

    const { data: condition } = await admin.from("price_conditions").select("code,name,price_list_id").eq("id", conditionId).single();
    expect(condition?.code).toBe(code);

    const { data: priceList } = await admin.from("price_lists").select("id,code").eq("id", condition!.price_list_id).single();
    expect(priceList?.code).toBe(code);

    const { data: methodLinks } = await admin.from("price_condition_payment_methods").select("payment_method_id").eq("price_condition_id", conditionId);
    expect(methodLinks).toHaveLength(1);
    expect(methodLinks![0].payment_method_id).toBe(cash!.id);
  });

  it("rejects a duplicate code — never creates a partial price_list for it", async () => {
    // 'general' ya existe como price_conditions.code (seed de la
    // migración) — pero apunta a la price_list 'retail', nunca a una
    // 'general' propia. El intento debe fallar por el código de la
    // CONDICIÓN, sin dejar ninguna price_list nueva a medio crear.
    const { error } = await admin.rpc("create_price_condition", {
      p_code: "general",
      p_name: "Duplicado (test)",
      p_payment_method_ids: [],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("condición de precio");

    const { count } = await admin.from("price_lists").select("id", { count: "exact", head: true }).eq("code", "general");
    expect(count).toBe(0);
  });

  it("also rejects a code that collides with an existing price_list that isn't a condition (e.g. 'retail')", async () => {
    const { error } = await admin.rpc("create_price_condition", {
      p_code: "retail",
      p_name: "Colisión con retail (test)",
      p_payment_method_ids: [],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("lista de precios");

    const { count } = await admin.from("price_conditions").select("id", { count: "exact", head: true }).eq("code", "retail");
    expect(count).toBe(0);
  });

  it("editing a condition's price_list_items later never alters an order already confirmed under it (snapshot semantics)", async () => {
    const { data: locationRow } = await admin.from("locations").select("id").eq("code", "la-plata").single();
    const { data: bankTransfer } = await admin.from("payment_methods").select("id").eq("code", "bank_transfer").single();
    const { data: item } = await admin.from("inventory_items").select("id").eq("product_variant_id", variantId).single();
    await admin.from("inventory_movements").insert({ inventory_item_id: item!.id, location_id: locationRow!.id, movement_type: "production_in", quantity: 5 });

    const { data: sale, error: saleError } = await admin.rpc("create_quick_retail_sale", {
      p_location_id: locationRow!.id,
      p_items: [{ product_variant_id: variantId, quantity: 1 }],
      p_payment_method_id: bankTransfer!.id,
      p_paid_at: new Date().toISOString(),
      p_price_condition_id: generalConditionId,
    });
    expect(saleError).toBeNull();
    const orderId = (sale as { order_id: string }[])[0].order_id;

    // Cambia el precio de 'general' DESPUÉS de la venta — la venta ya
    // confirmada nunca debe reflejar el precio nuevo.
    const { data: generalList } = await admin.from("price_conditions").select("price_list_id").eq("id", generalConditionId).single();
    await admin
      .from("price_list_items")
      .update({ unit_price: 999999 })
      .eq("price_list_id", generalList!.price_list_id)
      .eq("product_variant_id", variantId);

    const { data: order } = await admin.from("orders").select("total").eq("id", orderId).single();
    expect(order?.total).toBe(1000);

    // Restaurar el precio para no afectar otros tests que corran después.
    await admin
      .from("price_list_items")
      .update({ unit_price: 1000 })
      .eq("price_list_id", generalList!.price_list_id)
      .eq("product_variant_id", variantId);
    await admin.from("orders").delete().eq("id", orderId);
  });
});
