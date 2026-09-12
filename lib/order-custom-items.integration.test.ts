import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// los ítems no inventariados/personalizados de un pedido (tanda de
// usabilidad, sección 8): create_order (RPC) ahora acepta, por ítem, o
// bien `product_variant_id` (catálogo) o bien `custom_name` (no
// inventariado) — nunca los dos, nunca ninguno. Un ítem custom participa
// del total pero NUNCA descuenta stock ni crea un producto permanente.

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

describe.skipIf(!hasCredentials)("create_order — custom/non-stock items (local)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let customUnitId: string;
  let locationId: string;
  let customerId: string;
  const createdOrderIds: string[] = [];

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

    const { data: unit } = await admin.from("business_units").select("id").eq("code", "custom").single();
    customUnitId = unit!.id;
    const { data: location } = await admin.from("locations").select("id").eq("code", "la-plata").single();
    locationId = location!.id;
    const { data: customer } = await admin.from("customers").insert({ first_name: "Custom Item Fixture" }).select("id").single();
    customerId = customer!.id;
  });

  afterAll(async () => {
    await admin.from("orders").delete().in("id", createdOrderIds);
    await admin.from("customers").delete().eq("id", customerId);
  });

  it("creates an order with a custom item, no product_variant_id, and the right total", async () => {
    const { data: orderId, error } = await owner.rpc("create_order", {
      p_business_unit_id: customUnitId,
      p_customer_id: customerId,
      p_location_id: null,
      p_origin_channel_id: null,
      p_closing_channel_id: null,
      p_delivery_method: null,
      p_delivery_address: null,
      p_estimated_date: null,
      p_notes: null,
      p_items: [{ custom_name: "30 tazas personalizadas", custom_description: "Logo empresa X, azul petróleo", quantity: 30, unit_price: 18000 }],
    });
    expect(error).toBeNull();
    createdOrderIds.push(orderId as string);

    const { data: item } = await admin.from("order_items").select("product_variant_id,custom_name,custom_description,quantity,unit_price").eq("order_id", orderId).single();
    expect(item?.product_variant_id).toBeNull();
    expect(item?.custom_name).toBe("30 tazas personalizadas");
    expect(item?.quantity).toBe(30);

    const { data: order } = await admin.from("orders").select("total,operation_type").eq("id", orderId).single();
    expect(order?.total).toBe(540000);
    // Bloque 2: create_order siempre marca 'order' — nunca 'retail_sale',
    // sin importar la unidad de negocio o si el ítem es custom.
    expect(order?.operation_type).toBe("order");
  });

  it("rejects an item with neither product_variant_id nor custom_name", async () => {
    const { error } = await owner.rpc("create_order", {
      p_business_unit_id: customUnitId,
      p_customer_id: customerId,
      p_location_id: null,
      p_origin_channel_id: null,
      p_closing_channel_id: null,
      p_delivery_method: null,
      p_delivery_address: null,
      p_estimated_date: null,
      p_notes: null,
      p_items: [{ quantity: 1, unit_price: 1000 }],
    });
    expect(error).not.toBeNull();
  });

  it("never reserves or consumes stock for a custom item through confirmed/delivered", async () => {
    const { data: orderId } = await owner.rpc("create_order", {
      p_business_unit_id: customUnitId,
      p_customer_id: customerId,
      p_location_id: locationId,
      p_origin_channel_id: null,
      p_closing_channel_id: null,
      p_delivery_method: null,
      p_delivery_address: null,
      p_estimated_date: null,
      p_notes: null,
      p_items: [{ custom_name: "Encargo especial", quantity: 5, unit_price: 10000 }],
    });
    createdOrderIds.push(orderId as string);

    const { error: confirmError } = await owner.rpc("set_order_status", { p_order_id: orderId, p_new_status: "confirmed" });
    expect(confirmError).toBeNull();
    const { count: reservations } = await admin.from("inventory_reservations").select("id", { count: "exact", head: true }).eq("order_id", orderId);
    expect(reservations).toBe(0);
    const { count: productionOrders } = await admin.from("production_orders").select("id", { count: "exact", head: true }).eq("order_id", orderId);
    expect(productionOrders).toBe(0);

    const { error: deliverError } = await owner.rpc("set_order_status", { p_order_id: orderId, p_new_status: "delivered" });
    expect(deliverError).toBeNull();
    const { count: movements } = await admin
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("reference_table", "orders")
      .eq("reference_id", orderId);
    expect(movements).toBe(0);

    const { data: order } = await admin.from("orders").select("status,total").eq("id", orderId).single();
    expect(order?.status).toBe("delivered");
    expect(order?.total).toBe(50000);
  });

  it("a custom item never creates a row in products/product_variants", async () => {
    // Comparar un conteo global de `products` antes/después es una
    // condición de carrera real cuando otros archivos de test corren en
    // paralelo contra el mismo Supabase local y crean productos propios
    // (mismo problema ya resuelto en quick-retail-sale.integration.test.ts).
    // En cambio, buscar por el nombre exacto del ítem custom es
    // determinístico: si create_order alguna vez creara un producto por
    // error, lo más probable es que lo nombre igual que el custom_name.
    const uniqueCustomName = `Pieza única ${crypto.randomUUID()}`;
    const { data: orderId } = await owner.rpc("create_order", {
      p_business_unit_id: customUnitId,
      p_customer_id: customerId,
      p_location_id: null,
      p_origin_channel_id: null,
      p_closing_channel_id: null,
      p_delivery_method: null,
      p_delivery_address: null,
      p_estimated_date: null,
      p_notes: null,
      p_items: [{ custom_name: uniqueCustomName, quantity: 1, unit_price: 30000 }],
    });
    createdOrderIds.push(orderId as string);
    const { count: matchingProducts } = await admin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("name", uniqueCustomName);
    expect(matchingProducts).toBe(0);
  });
});
