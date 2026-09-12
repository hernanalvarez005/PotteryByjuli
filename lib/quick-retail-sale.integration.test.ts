import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción) — necesita
// crear productos/stock/ventas de prueba de verdad para probar
// create_quick_retail_sale, algo que nunca se hace contra datos reales
// (misma política que el resto de esta sesión). Usa el cliente admin para
// el setup y un cliente anon logueado como el usuario owner de prueba para
// llamar el RPC exactamente como lo llamaría la app (createQuickSale en
// app/(app)/pedidos/venta-rapida/actions.ts).
//
// Precisiones de la usuaria que estos tests existen específicamente para
// blindar (ExitPlanMode, 2026-09-11): el precio nunca lo decide el
// cliente; el stock se valida y descuenta bajo lock, sin ventana abierta;
// cualquier falla (stock insuficiente, descuento inválido) deshace TODA la
// operación, no sólo el pedido; la idempotencia por client_request_id se
// chequea antes de tocar stock o pagos, y una segunda llamada no vuelve a
// insertar nada.

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

type SaleResult = { order_id: string; human_code: string; total: number };

describe.skipIf(!hasCredentials)("create_quick_retail_sale (local)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let categoryId: string;
  let locationId: string;
  let otherLocationId: string;
  let bankTransferMethodId: string;
  const createdProductIds: string[] = [];

  /** Producto con su variante única (auto-creada), precio minorista
   * cargado, y opcionalmente stock inicial ya cargado en `locationId`. */
  async function makeVariant(name: string, retailPrice: number, initialStock = 0, atLocationId = locationId) {
    const { data: product, error } = await admin
      .from("products")
      .insert({ name, category_id: categoryId, is_active: true })
      .select("id")
      .single();
    if (error) throw error;
    createdProductIds.push(product.id);

    const { data: variant } = await admin
      .from("product_variants")
      .select("id")
      .eq("product_id", product.id)
      .single();
    const variantId = variant!.id as string;

    const { data: retailList } = await admin.from("price_lists").select("id").eq("code", "retail").single();
    await admin
      .from("price_list_items")
      .insert({ price_list_id: retailList!.id, product_variant_id: variantId, unit_price: retailPrice });

    if (initialStock > 0) {
      const { data: item } = await admin
        .from("inventory_items")
        .select("id")
        .eq("product_variant_id", variantId)
        .single();
      await admin.from("inventory_movements").insert({
        inventory_item_id: item!.id,
        location_id: atLocationId,
        movement_type: "production_in",
        quantity: initialStock,
      });
    }

    return { productId: product.id as string, variantId, name };
  }

  async function physicalStock(variantId: string, atLocationId = locationId) {
    const { data: item } = await admin.from("inventory_items").select("id").eq("product_variant_id", variantId).single();
    const { data: movements } = await admin
      .from("inventory_movements")
      .select("quantity")
      .eq("inventory_item_id", item!.id)
      .eq("location_id", atLocationId);
    return (movements ?? []).reduce((sum, m) => sum + Number(m.quantity), 0);
  }

  function callSale(overrides: Record<string, unknown> = {}) {
    return owner.rpc("create_quick_retail_sale", {
      p_location_id: locationId,
      p_items: [],
      p_payment_method_id: bankTransferMethodId,
      p_paid_at: new Date().toISOString(),
      p_customer_id: null,
      p_channel_id: null,
      p_payment_account_id: null,
      p_discount_total: 0,
      p_client_request_id: null,
      ...overrides,
    });
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
      .insert({ name: "Quick sale test", code: `quick-sale-test-${Date.now()}` })
      .select("id")
      .single();
    if (catErr) throw catErr;
    categoryId = category.id;

    const { data: laPlata } = await admin.from("locations").select("id").eq("code", "la-plata").single();
    locationId = laPlata!.id;
    const { data: tresLomas } = await admin.from("locations").select("id").eq("code", "tres-lomas").single();
    otherLocationId = tresLomas!.id;
    const { data: bankTransfer } = await admin.from("payment_methods").select("id").eq("code", "bank_transfer").single();
    bankTransferMethodId = bankTransfer!.id;
  });

  afterAll(async () => {
    await admin.from("products").delete().in("id", createdProductIds);
    await admin.from("product_categories").delete().eq("id", categoryId);
  });

  it("registers a basic sale: creates the order delivered, deducts stock, registers the payment", async () => {
    const { variantId } = await makeVariant("Taza básica", 2000, 5);
    const before = await physicalStock(variantId);

    const { data, error } = await callSale({
      p_items: [{ product_variant_id: variantId, quantity: 2 }],
    });
    expect(error).toBeNull();
    const result = (data as SaleResult[])[0];
    expect(result.total).toBe(4000);

    const { data: order } = await admin
      .from("orders")
      .select("status,total,customer_id,location_id")
      .eq("id", result.order_id)
      .single();
    expect(order?.status).toBe("delivered");
    expect(order?.total).toBe(4000);
    expect(order?.customer_id).toBeNull();
    expect(order?.location_id).toBe(locationId);

    const { data: payment } = await admin.from("payments").select("amount").eq("order_id", result.order_id).single();
    expect(payment?.amount).toBe(4000);

    expect(await physicalStock(variantId)).toBe(before - 2);
  });

  it("works with no customer", async () => {
    const { variantId } = await makeVariant("Sin cliente", 1000, 5);
    const { data, error } = await callSale({ p_items: [{ product_variant_id: variantId, quantity: 1 }] });
    expect(error).toBeNull();
    const { data: order } = await admin.from("orders").select("customer_id").eq("id", (data as SaleResult[])[0].order_id).single();
    expect(order?.customer_id).toBeNull();
  });

  it("associates the customer correctly when one is given", async () => {
    const { variantId } = await makeVariant("Con cliente", 1000, 5);
    const { data: customer } = await admin.from("customers").insert({ first_name: "Cliente Venta Rápida" }).select("id").single();

    const { data, error } = await callSale({
      p_items: [{ product_variant_id: variantId, quantity: 1 }],
      p_customer_id: customer!.id,
    });
    expect(error).toBeNull();
    const { data: order } = await admin.from("orders").select("customer_id").eq("id", (data as SaleResult[])[0].order_id).single();
    expect(order?.customer_id).toBe(customer!.id);

    await admin.from("orders").delete().eq("id", (data as SaleResult[])[0].order_id);
    await admin.from("customers").delete().eq("id", customer!.id);
  });

  it("updates stock for both variants in a two-product sale", async () => {
    const a = await makeVariant("Multi A", 1500, 5);
    const b = await makeVariant("Multi B", 2500, 5);

    const { data, error } = await callSale({
      p_items: [
        { product_variant_id: a.variantId, quantity: 2 },
        { product_variant_id: b.variantId, quantity: 1 },
      ],
    });
    expect(error).toBeNull();
    expect((data as SaleResult[])[0].total).toBe(2 * 1500 + 2500);
    expect(await physicalStock(a.variantId)).toBe(3);
    expect(await physicalStock(b.variantId)).toBe(4);
  });

  it("stores the retroactive paid_at exactly as given", async () => {
    const { variantId } = await makeVariant("Retroactiva", 1000, 5);
    const { data, error } = await callSale({
      p_items: [{ product_variant_id: variantId, quantity: 1 }],
      p_paid_at: "2026-01-15T12:00:00-03:00",
    });
    expect(error).toBeNull();
    const { data: payment } = await admin
      .from("payments")
      .select("paid_at")
      .eq("order_id", (data as SaleResult[])[0].order_id)
      .single();
    expect(new Date(payment!.paid_at).toISOString().slice(0, 10)).toBe("2026-01-15");
  });

  it("double submit with the same client_request_id creates only one sale — no duplicate order_items/movements/payments", async () => {
    const { variantId } = await makeVariant("Doble submit", 1000, 5);
    const requestId = crypto.randomUUID();

    const first = await callSale({
      p_items: [{ product_variant_id: variantId, quantity: 1 }],
      p_client_request_id: requestId,
    });
    expect(first.error).toBeNull();
    const second = await callSale({
      p_items: [{ product_variant_id: variantId, quantity: 1 }],
      p_client_request_id: requestId,
    });
    expect(second.error).toBeNull();

    expect((first.data as SaleResult[])[0].order_id).toBe((second.data as SaleResult[])[0].order_id);

    const orderId = (first.data as SaleResult[])[0].order_id;
    const { count: orderCount } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("client_request_id", requestId);
    expect(orderCount).toBe(1);
    const { count: itemCount } = await admin.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", orderId);
    expect(itemCount).toBe(1);
    const { count: paymentCount } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("order_id", orderId);
    expect(paymentCount).toBe(1);
    // Sólo se descontó una vez — no dos.
    expect(await physicalStock(variantId)).toBe(4);
  });

  it("insufficient stock across two items rolls back everything — zero new rows anywhere, names the short product", async () => {
    const ok = await makeVariant("Alcanza", 1000, 10);
    const short = await makeVariant("No alcanza", 1000, 1);
    // Un client_request_id propio de este intento — así "cero pedidos
    // nuevos" se puede confirmar de forma exacta (contando sólo pedidos
    // con ESTE id) en vez de comparar el conteo total de `orders` antes/
    // después, que es una condición de carrera real cuando otros
    // archivos de test corren en paralelo contra la misma base local.
    const requestId = crypto.randomUUID();

    const { error } = await callSale({
      p_items: [
        { product_variant_id: ok.variantId, quantity: 1 },
        { product_variant_id: short.variantId, quantity: 5 },
      ],
      p_client_request_id: requestId,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("No alcanza");

    const { count: ordersWithThisRequestId } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("client_request_id", requestId);
    expect(ordersWithThisRequestId).toBe(0);
    // Ninguno de los dos ítems se tocó — ni siquiera el que sí alcanzaba.
    expect(await physicalStock(ok.variantId)).toBe(10);
    expect(await physicalStock(short.variantId)).toBe(1);
  });

  it("ignores a manipulated unit_price in the items payload — always stores the real price_list_items price", async () => {
    const { variantId } = await makeVariant("Precio real", 3000, 5);
    const { data, error } = await callSale({
      p_items: [{ product_variant_id: variantId, quantity: 1, unit_price: 1 }],
    });
    expect(error).toBeNull();
    const { data: item } = await admin
      .from("order_items")
      .select("unit_price")
      .eq("order_id", (data as SaleResult[])[0].order_id)
      .single();
    expect(item?.unit_price).toBe(3000);
  });

  it("rejects a discount above the real subtotal — never lets total go negative", async () => {
    const { variantId } = await makeVariant("Descuento excesivo", 1000, 5);
    const { error } = await callSale({
      p_items: [{ product_variant_id: variantId, quantity: 1 }],
      p_discount_total: 999999,
    });
    expect(error).not.toBeNull();
    expect(await physicalStock(variantId)).toBe(5);
  });

  // Test de concurrencia real (requisito explícito de la usuaria): stock=1,
  // dos llamadas en paralelo — exactamente una debe ganar, la otra debe
  // fallar con el error de stock, y el stock final nunca debe quedar en -1.
  it("under real concurrency with stock=1, exactly one of two parallel sales succeeds and stock never goes negative", async () => {
    const { variantId } = await makeVariant("Concurrencia", 2000, 1);

    const [a, b] = await Promise.all([
      callSale({ p_items: [{ product_variant_id: variantId, quantity: 1 }] }),
      callSale({ p_items: [{ product_variant_id: variantId, quantity: 1 }] }),
    ]);

    const results = [a, b];
    const succeeded = results.filter((r) => r.error === null);
    const failed = results.filter((r) => r.error !== null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].error!.message).toContain("No hay stock suficiente");

    expect(await physicalStock(variantId)).toBe(0);
  });

  it("registers the sale at a specific location and never touches another location's stock", async () => {
    const { variantId } = await makeVariant("Multi ubicación", 1000, 3);
    // stock también en la otra ubicación, no debería tocarse
    const { data: item } = await admin.from("inventory_items").select("id").eq("product_variant_id", variantId).single();
    await admin.from("inventory_movements").insert({
      inventory_item_id: item!.id,
      location_id: otherLocationId,
      movement_type: "production_in",
      quantity: 10,
    });

    const { error } = await callSale({ p_items: [{ product_variant_id: variantId, quantity: 2 }] });
    expect(error).toBeNull();
    expect(await physicalStock(variantId, locationId)).toBe(1);
    expect(await physicalStock(variantId, otherLocationId)).toBe(10);
  });
});
