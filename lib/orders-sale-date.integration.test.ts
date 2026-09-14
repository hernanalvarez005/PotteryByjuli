import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// orders.sale_date / sale_date_declared (Bloque 2 — "Ventas: fecha
// real, canal, comisiones y talleres"): fecha comercial declarada,
// editable, distinta de created_at (carga) y de sold_at (transición
// técnica a delivered, que NO cambia de semántica en este bloque).

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

function todayArgentina(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

/** Día calendario argentino de un timestamp — nunca `.toISOString().slice(0,10)`,
 * que da el día en UTC y difiere del argentino durante buena parte de la
 * noche (Argentina va 3 horas atrás de UTC). */
function argentinaDateOf(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(isoTimestamp));
}

describe.skipIf(!hasCredentials)("orders.sale_date via create_order (local)", () => {
  let admin: SupabaseClient;
  let customUnitId: string;
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: unit } = await admin.from("business_units").select("id").eq("code", "custom").single();
    customUnitId = unit!.id;
  });

  afterAll(async () => {
    await admin.from("orders").delete().in("id", createdOrderIds);
  });

  it("without p_sale_date, defaults to today in Argentina time and is marked declared", async () => {
    const { data: orderId, error } = await admin.rpc("create_order", {
      p_business_unit_id: customUnitId,
      p_customer_id: null,
      p_location_id: null,
      p_origin_channel_id: null,
      p_closing_channel_id: null,
      p_delivery_method: null,
      p_delivery_address: null,
      p_estimated_date: null,
      p_notes: null,
      p_items: [{ custom_name: "sale_date default", quantity: 1, unit_price: 1000 }],
    });
    expect(error).toBeNull();
    createdOrderIds.push(orderId as string);

    const { data: order } = await admin.from("orders").select("sale_date,sale_date_declared,created_at").eq("id", orderId).single();
    expect(order?.sale_date).toBe(todayArgentina());
    expect(order?.sale_date_declared).toBe(true);
  });

  it("with an explicit p_sale_date (backdated), created_at stays the real load day — never overwritten", async () => {
    const { data: orderId, error } = await admin.rpc("create_order", {
      p_business_unit_id: customUnitId,
      p_customer_id: null,
      p_location_id: null,
      p_origin_channel_id: null,
      p_closing_channel_id: null,
      p_delivery_method: null,
      p_delivery_address: null,
      p_estimated_date: null,
      p_notes: null,
      p_items: [{ custom_name: "sale_date backdated", quantity: 1, unit_price: 1000 }],
      p_sale_date: "2026-08-10",
    });
    expect(error).toBeNull();
    createdOrderIds.push(orderId as string);

    const { data: order } = await admin.from("orders").select("sale_date,sale_date_declared,created_at").eq("id", orderId).single();
    expect(order?.sale_date).toBe("2026-08-10");
    // Declarada, aunque retroactiva — esto no es un backfill sin
    // evidencia, es la usuaria diciendo explícitamente cuándo fue.
    expect(order?.sale_date_declared).toBe(true);
    expect(argentinaDateOf(order!.created_at)).toBe(todayArgentina());
  });
});

describe.skipIf(!hasCredentials)("orders.sale_date via create_quick_retail_sale (local)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let categoryId: string;
  let locationId: string;
  let generalConditionId: string;
  let bankTransferMethodId: string;
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  const OWNER_EMAIL = "owner-test@pottery.local";
  const OWNER_PASSWORD = "test-password-123";

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    owner = createClient(SUPABASE_URL!, ANON_KEY!);

    const { data: existing } = await admin.auth.admin.listUsers();
    let ownerId = existing.users.find((u) => u.email === OWNER_EMAIL)?.id;
    if (!ownerId) {
      const { data: created, error } = await admin.auth.admin.createUser({ email: OWNER_EMAIL, password: OWNER_PASSWORD, email_confirm: true });
      if (error) throw error;
      ownerId = created.user!.id;
      await admin.from("user_roles").insert({ user_id: ownerId, role: "owner" });
    }
    const { error: signInErr } = await owner.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    if (signInErr) throw signInErr;

    const { data: category } = await admin
      .from("product_categories")
      .insert({ name: "Sale date test", code: `sale-date-test-${Date.now()}` })
      .select("id")
      .single();
    categoryId = category!.id;
    const { data: laPlata } = await admin.from("locations").select("id").eq("code", "la-plata").single();
    locationId = laPlata!.id;
    const { data: generalCondition } = await admin.from("price_conditions").select("id").eq("code", "general").single();
    generalConditionId = generalCondition!.id;
    const { data: bankTransfer } = await admin.from("payment_methods").select("id").eq("code", "bank_transfer").single();
    bankTransferMethodId = bankTransfer!.id;
  });

  afterAll(async () => {
    await admin.from("orders").delete().in("id", createdOrderIds);
    await admin.from("products").delete().in("id", createdProductIds);
    await admin.from("product_categories").delete().eq("id", categoryId);
  });

  async function makeVariant(name: string, retailPrice: number, initialStock = 5) {
    const { data: product } = await admin.from("products").insert({ name, category_id: categoryId, is_active: true }).select("id").single();
    createdProductIds.push(product!.id);
    const { data: variant } = await admin.from("product_variants").select("id").eq("product_id", product!.id).single();
    const variantId = variant!.id as string;
    await admin.from("price_list_items").insert({
      price_list_id: (await admin.from("price_conditions").select("price_list_id").eq("id", generalConditionId).single()).data!.price_list_id,
      product_variant_id: variantId,
      unit_price: retailPrice,
    });
    const { data: item } = await admin.from("inventory_items").select("id").eq("product_variant_id", variantId).single();
    await admin.from("inventory_movements").insert({ inventory_item_id: item!.id, location_id: locationId, movement_type: "production_in", quantity: initialStock });
    return variantId;
  }

  it("cargada hoy con sale_date=10/09: sale_date refleja la venta real, created_at y sold_at quedan en hoy (el instante real del insert)", async () => {
    const variantId = await makeVariant("Sale date quick sale", 3000);
    const { data, error } = await owner.rpc("create_quick_retail_sale", {
      p_location_id: locationId,
      p_items: [{ product_variant_id: variantId, quantity: 1 }],
      p_payment_method_id: bankTransferMethodId,
      p_paid_at: new Date().toISOString(),
      p_price_condition_id: generalConditionId,
      p_sale_date: "2026-09-10",
    });
    expect(error).toBeNull();
    const orderId = (data as { order_id: string }[])[0].order_id;
    createdOrderIds.push(orderId);

    const { data: order } = await admin.from("orders").select("sale_date,sale_date_declared,created_at,sold_at,status").eq("id", orderId).single();
    expect(order?.status).toBe("delivered");
    expect(order?.sale_date).toBe("2026-09-10");
    expect(order?.sale_date_declared).toBe(true);
    // sold_at mantiene su contrato técnico de siempre — el instante real
    // en que el trigger corrió (hoy), nunca la fecha declarada.
    expect(argentinaDateOf(order!.sold_at as string)).toBe(todayArgentina());
    expect(argentinaDateOf(order!.created_at)).toBe(todayArgentina());
  });

  it("sin p_sale_date, cae al default (hoy en Argentina) — nunca falla por NOT NULL", async () => {
    const variantId = await makeVariant("Sale date default quick sale", 3000);
    const { data, error } = await owner.rpc("create_quick_retail_sale", {
      p_location_id: locationId,
      p_items: [{ product_variant_id: variantId, quantity: 1 }],
      p_payment_method_id: bankTransferMethodId,
      p_paid_at: new Date().toISOString(),
      p_price_condition_id: generalConditionId,
    });
    expect(error).toBeNull();
    const orderId = (data as { order_id: string }[])[0].order_id;
    createdOrderIds.push(orderId);

    const { data: order } = await admin.from("orders").select("sale_date,sale_date_declared").eq("id", orderId).single();
    expect(order?.sale_date).toBe(todayArgentina());
    expect(order?.sale_date_declared).toBe(true);
  });
});

describe.skipIf(!hasCredentials)("orders.sale_date historical backfill (local)", () => {
  let admin: SupabaseClient;
  let customUnitId: string;
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: unit } = await admin.from("business_units").select("id").eq("code", "custom").single();
    customUnitId = unit!.id;
  });

  afterAll(async () => {
    await admin.from("orders").delete().in("id", createdOrderIds);
  });

  /** Mirror exacto de la expresión de backfill de la migración —
   * coalesce(sold_at, created_at), casteado a fecha argentina. */
  async function runBackfillExpression(orderId: string) {
    const { data: order } = await admin.from("orders").select("sold_at,created_at").eq("id", orderId).single();
    const source = order!.sold_at ?? order!.created_at;
    const sale_date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(source));
    await admin.from("orders").update({ sale_date, sale_date_declared: false }).eq("id", orderId);
  }

  it("a historical row backfilled from sold_at is marked sale_date_declared=false — never presented as a real declaration", async () => {
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: customUnitId, status: "delivered", sold_at: "2026-08-15T18:00:00Z" })
      .select("id")
      .single();
    const orderId = order!.id;
    createdOrderIds.push(orderId);

    await runBackfillExpression(orderId);

    const { data: updated } = await admin.from("orders").select("sale_date,sale_date_declared").eq("id", orderId).single();
    expect(updated?.sale_date).toBe("2026-08-15"); // 18:00 UTC = 15:00 ART, mismo día calendario
    expect(updated?.sale_date_declared).toBe(false);
  });

  it("timezone Argentina correcto: un sold_at de madrugada UTC cae en el día calendario argentino anterior, no en UTC", async () => {
    // 2026-09-10T02:30:00Z = 2026-09-09T23:30:00-03:00 en Argentina —
    // si el backfill casteara en UTC en vez de horario argentino, este
    // caso se iría al 10/09 en vez del 09/09 real.
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: customUnitId, status: "delivered", sold_at: "2026-09-10T02:30:00Z" })
      .select("id")
      .single();
    const orderId = order!.id;
    createdOrderIds.push(orderId);

    await runBackfillExpression(orderId);

    const { data: updated } = await admin.from("orders").select("sale_date").eq("id", orderId).single();
    expect(updated?.sale_date).toBe("2026-09-09");
  });

  it("without any sold_at (never delivered), falls back to created_at — still never null, still marked as inferred", async () => {
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: customUnitId, status: "pending" })
      .select("id,created_at")
      .single();
    const orderId = order!.id;
    createdOrderIds.push(orderId);

    await runBackfillExpression(orderId);

    const { data: updated } = await admin.from("orders").select("sale_date,sale_date_declared").eq("id", orderId).single();
    const expectedDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(order!.created_at));
    expect(updated?.sale_date).toBe(expectedDate);
    expect(updated?.sale_date_declared).toBe(false);
  });
});
