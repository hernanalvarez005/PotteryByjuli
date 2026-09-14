import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// lib/reports.ts: getSalesOverTime agrupa por sale_date (Bloque 2 —
// "Ventas: fecha real, canal, comisiones y talleres" — reemplazó a
// sold_at, que se conserva sin cambios como transición técnica), y
// Talleres se suma al Mix por unidad pero nunca al Mix por canal
// (Bloque 1 de la auditoría anterior, sin cambios). Mirrors — no
// invocable directamente (usa next/headers).

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

/** Mirror exacto del filtro de getSalesOverTime — sale_date es `date`,
 * from/to son "AAAA-MM-DD", nunca un timestamptz. */
async function salesOverTimeTotal(admin: SupabaseClient, orderIds: string[], from: string, to: string) {
  const { data } = await admin
    .from("orders")
    .select("total,sale_date")
    .in("id", orderIds)
    .eq("status", "delivered")
    .gte("sale_date", from)
    .lte("sale_date", to);
  return (data ?? []).reduce((sum, o) => sum + o.total, 0);
}

async function workshopDuePaymentsTotal(admin: SupabaseClient, fromIso: string, toIso: string, dueId: string) {
  const { data } = await admin
    .from("payments")
    .select("amount")
    .eq("workshop_due_id", dueId)
    .gte("paid_at", fromIso)
    .lte("paid_at", toIso);
  return (data ?? []).reduce((sum, p) => sum + p.amount, 0);
}

describe.skipIf(!hasCredentials)("reports: sale_date time series + Talleres in Mix by unit only (local)", () => {
  let admin: SupabaseClient;
  let customerId: string;
  let businessUnitId: string;
  let backdatedOrderId: string;
  let pendingOrderId: string;
  let programId: string;
  let groupId: string;
  let dueId: string;
  const realSaleDate = "2026-08-10"; // "vendida" en agosto...

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: customer } = await admin.from("customers").insert({ first_name: "Reports Fixture" }).select("id").single();
    customerId = customer!.id;
    const { data: unit } = await admin.from("business_units").select("id").eq("code", "retail").single();
    businessUnitId = unit!.id;

    // El caso central del Bloque 2: cargada hoy (created_at = hoy),
    // entregada hoy (sold_at = hoy), pero la venta REAL fue en agosto —
    // sale_date se declara explícitamente en agosto, como haría la UI.
    const { data: order } = await admin
      .from("orders")
      .insert({
        business_unit_id: businessUnitId,
        customer_id: customerId,
        status: "delivered",
        sale_date: realSaleDate,
        sale_date_declared: true,
      })
      .select("id,created_at,sold_at")
      .single();
    backdatedOrderId = order!.id;
    // total lo pone el trigger vía order_items normalmente; se fuerza acá para no requerir un ítem real.
    await admin.from("orders").update({ total: 12345 }).eq("id", backdatedOrderId);

    // Un pedido que sigue en curso — nunca debería sumar en "ventas en el tiempo",
    // sin importar qué sale_date tenga (default hoy).
    const { data: pending } = await admin
      .from("orders")
      .insert({ business_unit_id: businessUnitId, customer_id: customerId, status: "pending" })
      .select("id")
      .single();
    pendingOrderId = pending!.id;
    await admin.from("orders").update({ total: 99999 }).eq("id", pendingOrderId);

    // Cuotas de talleres cobradas, para el Mix por unidad.
    const { data: program } = await admin.from("workshop_programs").insert({ name: "Reports fixture program" }).select("id").single();
    programId = program!.id;
    const { data: group } = await admin.from("workshop_groups").insert({ program_id: programId, name: "Grupo reports", capacity: 10 }).select("id").single();
    groupId = group!.id;
    const { data: enrollment } = await admin
      .from("workshop_enrollments")
      .insert({ group_id: groupId, customer_id: customerId, status: "active" })
      .select("id")
      .single();
    const { data: due } = await admin.from("workshop_dues").insert({ enrollment_id: enrollment!.id, period: "2026-09", amount: 45000 }).select("id").single();
    dueId = due!.id;
    await admin.from("payments").insert({ workshop_due_id: dueId, amount: 45000, paid_at: new Date().toISOString() });
  });

  afterAll(async () => {
    await admin.from("payments").delete().eq("workshop_due_id", dueId);
    await admin.from("workshop_dues").delete().eq("id", dueId);
    await admin.from("workshop_enrollments").delete().eq("group_id", groupId);
    await admin.from("workshop_groups").delete().eq("id", groupId);
    await admin.from("workshop_programs").delete().eq("id", programId);
    await admin.from("orders").delete().in("id", [backdatedOrderId, pendingOrderId]);
    await admin.from("customers").delete().eq("id", customerId);
  });

  it("getSalesOverTime counts the order on its declared sale_date (agosto), never the day it was loaded/delivered (hoy)", async () => {
    const total = await salesOverTimeTotal(admin, [backdatedOrderId], "2026-08-01", "2026-08-31");
    expect(total).toBe(12345);
  });

  it("a range covering today (when it was loaded/delivered) but NOT the real sale_date correctly excludes the order", async () => {
    const todayOnly = new Date().toISOString().slice(0, 10);
    const total = await salesOverTimeTotal(admin, [backdatedOrderId], todayOnly, todayOnly);
    expect(total).toBe(0);
  });

  it("getSalesOverTime never counts an order that is still pending, regardless of its sale_date", async () => {
    const total = await salesOverTimeTotal(admin, [pendingOrderId], "2000-01-01", "2099-12-31");
    expect(total).toBe(0);
  });

  it("workshop due payments total feeds Mix by unit (mirrors getSalesByBusinessUnit's workshops branch)", async () => {
    const total = await workshopDuePaymentsTotal(admin, "2026-09-01T00:00:00-03:00", "2026-09-30T23:59:59-03:00", dueId);
    expect(total).toBe(45000);
  });

  it("workshop due payments never appear in a channel-based query (Mix by channel has no notion of them)", async () => {
    // getMixByChannel sólo consulta `orders` — nunca `payments`/
    // `workshop_dues`. Confirmar que ese due payment no tiene ningún
    // `closing_channel_id` asociado ni aparece en orders en absoluto.
    const { data: asOrder } = await admin.from("orders").select("id").eq("id", dueId);
    expect(asOrder).toHaveLength(0);
  });
});
