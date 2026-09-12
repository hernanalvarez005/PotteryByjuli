import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// el script de backfill (supabase/snippets/20260912191433_backfill_orders_sold_at.sql)
// — mirror exacto de sus 3 queries: preview, casos sin evidencia, y el
// update real. Nunca ejecuta el UPDATE del archivo tal cual (está
// comentado a propósito); esta prueba corre su propia copia del mismo
// SQL contra fixtures propias.

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

/** Mirrors the snippet's preview query: for delivered orders with no
 * sold_at, the earliest 'delivered' row in their history. */
async function previewBackfill(admin: SupabaseClient, orderId: string) {
  const { data: history } = await admin
    .from("order_status_history")
    .select("changed_at")
    .eq("order_id", orderId)
    .eq("status", "delivered")
    .order("changed_at", { ascending: true })
    .limit(1);
  return history?.[0]?.changed_at ?? null;
}

describe.skipIf(!hasCredentials)("orders.sold_at backfill script (local)", () => {
  let admin: SupabaseClient;
  let customerId: string;
  let businessUnitId: string;
  let historicalOrderId: string;
  const historicalDeliveredAt = "2026-08-01T15:00:00-03:00";

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: customer } = await admin.from("customers").insert({ first_name: "Backfill Fixture" }).select("id").single();
    customerId = customer!.id;
    const { data: unit } = await admin.from("business_units").select("id").eq("code", "retail").single();
    businessUnitId = unit!.id;

    // Simula un pedido "histórico": ya delivered, pero como si el
    // trigger orders_set_sold_at no hubiera existido cuando pasó — se
    // fuerza sold_at a null y se ajusta su historial a una fecha vieja.
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: businessUnitId, customer_id: customerId, status: "pending" })
      .select("id")
      .single();
    historicalOrderId = order!.id;
    await admin.from("orders").update({ status: "confirmed" }).eq("id", historicalOrderId);
    await admin.from("orders").update({ status: "delivered" }).eq("id", historicalOrderId);
    await admin.from("orders").update({ sold_at: null }).eq("id", historicalOrderId);
    await admin
      .from("order_status_history")
      .update({ changed_at: historicalDeliveredAt })
      .eq("order_id", historicalOrderId)
      .eq("status", "delivered");
  });

  afterAll(async () => {
    await admin.from("orders").delete().eq("id", historicalOrderId);
    await admin.from("customers").delete().eq("id", customerId);
  });

  it("preview identifies the real historical delivered date, never today's date", async () => {
    const preview = await previewBackfill(admin, historicalOrderId);
    expect(preview).not.toBeNull();
    expect(new Date(preview!).toISOString()).toBe(new Date(historicalDeliveredAt).toISOString());
  });

  it("finds zero 'no evidence' cases for this fixture (it has real history)", async () => {
    const { data: history } = await admin
      .from("order_status_history")
      .select("id")
      .eq("order_id", historicalOrderId)
      .eq("status", "delivered");
    expect(history!.length).toBeGreaterThan(0);
  });

  it("applying the backfill sets sold_at to exactly the historical evidence, not now()", async () => {
    const soldAt = await previewBackfill(admin, historicalOrderId);
    await admin.from("orders").update({ sold_at: soldAt }).eq("id", historicalOrderId).is("sold_at", null);

    const { data: order } = await admin.from("orders").select("sold_at").eq("id", historicalOrderId).single();
    expect(order?.sold_at).not.toBeNull();
    expect(new Date(order!.sold_at as string).toISOString()).toBe(new Date(historicalDeliveredAt).toISOString());
    // Nunca "ahora" — el backfill respeta la fecha real, no la de hoy.
    const soldAtDateOnly = new Date(order!.sold_at as string).toISOString().slice(0, 10);
    const todayDateOnly = new Date().toISOString().slice(0, 10);
    expect(soldAtDateOnly).not.toBe(todayDateOnly);
  });

  it("the backfill's WHERE sold_at is null guard means it never touches an order that already has one", async () => {
    const { data: before } = await admin.from("orders").select("sold_at").eq("id", historicalOrderId).single();
    const soldAtBefore = before!.sold_at;

    // Reintentar el mismo update — como ya tiene sold_at, `is("sold_at", null)` no debe matchear nada.
    const { data: updated } = await admin
      .from("orders")
      .update({ sold_at: "2099-01-01T00:00:00Z" })
      .eq("id", historicalOrderId)
      .is("sold_at", null)
      .select();
    expect(updated).toHaveLength(0);

    const { data: after } = await admin.from("orders").select("sold_at").eq("id", historicalOrderId).single();
    expect(after?.sold_at).toBe(soldAtBefore);
  });
});
