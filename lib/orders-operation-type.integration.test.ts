import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// orders.operation_type (auditoría "Próxima evolución operativa de
// Pottery", Bloque 2): create_order siempre crea 'order', create_quick_retail_sale
// siempre crea 'retail_sale', el listado de Ventas (operation_type='retail_sale')
// nunca mezcla pedidos, y el listado de Pedidos (operation_type='order') nunca
// mezcla ventas — mirror del filtro que usa getOrders (lib/orders.ts), que no es
// invocable directamente acá (usa next/headers).

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

describe.skipIf(!hasCredentials)("orders.operation_type (local)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let customUnitId: string;
  let retailLocationId: string;
  let bankTransferMethodId: string;
  let categoryId: string;
  const createdOrderIds: string[] = [];
  const createdProductIds: string[] = [];

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
    retailLocationId = location!.id;
    const { data: bankTransfer } = await admin.from("payment_methods").select("id").eq("code", "bank_transfer").single();
    bankTransferMethodId = bankTransfer!.id;

    const { data: category } = await admin
      .from("product_categories")
      .insert({ name: "Operation type test", code: `operation-type-test-${Date.now()}` })
      .select("id")
      .single();
    categoryId = category!.id;
  });

  afterAll(async () => {
    await admin.from("orders").delete().in("id", createdOrderIds);
    await admin.from("products").delete().in("id", createdProductIds);
    await admin.from("product_categories").delete().eq("id", categoryId);
  });

  it("create_order always sets operation_type='order', regardless of business unit", async () => {
    const { data: orderId, error } = await owner.rpc("create_order", {
      p_business_unit_id: customUnitId,
      p_customer_id: null,
      p_location_id: null,
      p_origin_channel_id: null,
      p_closing_channel_id: null,
      p_delivery_method: null,
      p_delivery_address: null,
      p_estimated_date: null,
      p_notes: null,
      p_items: [{ custom_name: "Encargo op-type", quantity: 1, unit_price: 5000 }],
    });
    expect(error).toBeNull();
    createdOrderIds.push(orderId as string);

    const { data: order } = await admin.from("orders").select("operation_type").eq("id", orderId).single();
    expect(order?.operation_type).toBe("order");
  });

  it("create_quick_retail_sale always sets operation_type='retail_sale'", async () => {
    const { data: product } = await admin
      .from("products")
      .insert({ name: "Op-type retail sale", category_id: categoryId, is_active: true })
      .select("id")
      .single();
    createdProductIds.push(product!.id);
    const { data: variant } = await admin.from("product_variants").select("id").eq("product_id", product!.id).single();
    const { data: retailList } = await admin.from("price_lists").select("id").eq("code", "retail").single();
    await admin.from("price_list_items").insert({ price_list_id: retailList!.id, product_variant_id: variant!.id, unit_price: 3000 });
    const { data: item } = await admin.from("inventory_items").select("id").eq("product_variant_id", variant!.id).single();
    await admin.from("inventory_movements").insert({ inventory_item_id: item!.id, location_id: retailLocationId, movement_type: "production_in", quantity: 5 });

    const { data, error } = await owner.rpc("create_quick_retail_sale", {
      p_location_id: retailLocationId,
      p_items: [{ product_variant_id: variant!.id, quantity: 1 }],
      p_payment_method_id: bankTransferMethodId,
      p_paid_at: new Date().toISOString(),
    });
    expect(error).toBeNull();
    const orderId = (data as { order_id: string }[])[0].order_id;
    createdOrderIds.push(orderId);

    const { data: order } = await admin.from("orders").select("operation_type").eq("id", orderId).single();
    expect(order?.operation_type).toBe("retail_sale");
  });

  it("the check constraint rejects any operation_type outside order/retail_sale", async () => {
    // business_unit_id válido a propósito — el error que importa acá es el
    // check de operation_type, no un not-null de otra columna.
    const { error } = await admin.from("orders").insert({ business_unit_id: customUnitId, operation_type: "wholesale_bulk" });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/operation_type|check/i);
  });

  it("Ventas listing (operation_type='retail_sale') never includes an 'order'-type row, and Pedidos never includes a 'retail_sale' row", async () => {
    // Mirror exacto del filtro de lib/orders.ts (getOrders no es invocable
    // acá — usa next/headers).
    const { data: pedidoRows } = await admin
      .from("orders")
      .select("id,operation_type")
      .in("id", createdOrderIds)
      .eq("operation_type", "order");
    const { data: ventaRows } = await admin
      .from("orders")
      .select("id,operation_type")
      .in("id", createdOrderIds)
      .eq("operation_type", "retail_sale");

    expect(pedidoRows).toHaveLength(1);
    expect(ventaRows).toHaveLength(1);
    expect(pedidoRows!.some((r) => ventaRows!.some((v) => v.id === r.id))).toBe(false);
  });

  it("existing rows (created before this migration) default to 'order', never a guessed 'retail_sale' — no historical backfill", async () => {
    // Simula un pedido "viejo": insertado sin especificar operation_type,
    // como lo haría cualquier fila creada antes de esta migración.
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: customUnitId })
      .select("id,operation_type")
      .single();
    createdOrderIds.push(order!.id);
    expect(order?.operation_type).toBe("order");
  });
});
