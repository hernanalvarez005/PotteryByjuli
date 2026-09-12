import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Bloquea
// específicamente el invariante pedido en la tanda de usabilidad
// (2026-09-11, ítem 3/16): "los gráficos/KPIs de cobros deben agrupar por
// payments.paid_at, NUNCA payments.created_at". Auditoría de
// lib/reports.ts confirmó que `filteredOrderPaymentsQuery` (usada por
// "Cobrado del período"/"Pendiente de cobro") ya filtra exclusivamente
// por `paid_at` — este test fija ese comportamiento como regresión,
// insertando un pago cuyo `created_at` (cuándo se cargó en Pottery) y
// `paid_at` (cuándo pasó el pago de verdad) caen en meses distintos, y
// confirmando que el filtro de rango sigue a `paid_at` en los dos
// sentidos (lo incluye cuando `paid_at` cae adentro aunque `created_at`
// esté afuera, y lo excluye cuando es al revés).
//
// No llama a getDashboardSummary directamente (usa `createClient` de
// lib/supabase/server, que depende de next/headers — no invocable fuera
// de un request de Next) — mismo patrón que
// dashboard-dues-location-filter.integration.test.ts: reproduce
// exactamente la query real.

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

/** Mirrors exactly getDashboardSummary's `filteredOrderPaymentsQuery`
 * (lib/reports.ts) — the query behind the "Cobrado del período" and
 * "Pendiente de cobro" KPIs. Scoped to one order id so this test's
 * assertions can't be thrown off by unrelated payments already sitting
 * in the local dev database. */
async function collectedForRange(admin: SupabaseClient, orderId: string, fromIso: string, toIso: string) {
  const { data, error } = await admin
    .from("payments")
    .select("amount,orders!inner(status)")
    .not("order_id", "is", null)
    .eq("order_id", orderId)
    .neq("orders.status", "cancelled")
    .gte("paid_at", fromIso)
    .lte("paid_at", toIso);
  if (error) throw error;
  return (data ?? []).reduce((sum, p) => sum + p.amount, 0);
}

describe.skipIf(!hasCredentials)("dashboard 'Cobrado' totals key off payments.paid_at, never created_at (local)", () => {
  let admin: SupabaseClient;
  let categoryId: string;
  let customerId: string;
  let businessUnitId: string;
  let orderId: string;
  let paymentId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    const { data: category } = await admin
      .from("product_categories")
      .insert({ name: "Paid-at test", code: `paid-at-test-${Date.now()}` })
      .select("id")
      .single();
    categoryId = category!.id;
    const { data: customer } = await admin.from("customers").insert({ first_name: "Paid At Fixture" }).select("id").single();
    customerId = customer!.id;
    const { data: unit } = await admin.from("business_units").select("id").eq("code", "retail").single();
    businessUnitId = unit!.id;

    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: businessUnitId, customer_id: customerId, status: "delivered" })
      .select("id")
      .single();
    orderId = order!.id;

    // El pago se carga en Pottery en enero (created_at), pero el pago
    // real ocurrió en septiembre (paid_at) — exactamente el caso del
    // ejemplo del pedido ("Pago real: 04/09, Carga en Pottery: 10/09").
    const { data: payment } = await admin
      .from("payments")
      .insert({ order_id: orderId, amount: 5000, paid_at: "2026-09-04T12:00:00-03:00", created_at: "2026-01-10T12:00:00-03:00" })
      .select("id")
      .single();
    paymentId = payment!.id;
  });

  afterAll(async () => {
    await admin.from("payments").delete().eq("id", paymentId);
    await admin.from("orders").delete().eq("id", orderId);
    await admin.from("customers").delete().eq("id", customerId);
    await admin.from("product_categories").delete().eq("id", categoryId);
  });

  it("counts the payment in the September range (paid_at), even though it was loaded in January", async () => {
    const total = await collectedForRange(admin, orderId, "2026-09-01T00:00:00-03:00", "2026-09-30T23:59:59-03:00");
    expect(total).toBe(5000);
  });

  it("does NOT count the payment in the January range (created_at) — that would mean the chart uses created_at", async () => {
    const total = await collectedForRange(admin, orderId, "2026-01-01T00:00:00-03:00", "2026-01-31T23:59:59-03:00");
    expect(total).toBe(0);
  });
});
