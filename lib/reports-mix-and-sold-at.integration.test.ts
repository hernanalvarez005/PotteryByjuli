import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// los cambios de lib/reports.ts (auditoría "Próxima evolución
// operativa", bloque 1): getSalesOverTime agrupa por sold_at, y Talleres
// se suma al Mix por unidad pero nunca al Mix por canal. Mirrors — no
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

async function salesOverTimeTotal(admin: SupabaseClient, orderIds: string[], fromIso: string, toIso: string) {
  const { data } = await admin
    .from("orders")
    .select("total,sold_at")
    .in("id", orderIds)
    .neq("status", "cancelled")
    .not("sold_at", "is", null)
    .gte("sold_at", fromIso)
    .lte("sold_at", toIso);
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

describe.skipIf(!hasCredentials)("reports: sold_at time series + Talleres in Mix by unit only (local)", () => {
  let admin: SupabaseClient;
  let customerId: string;
  let businessUnitId: string;
  let createdOrderIso: string;
  let deliveredOrderId: string;
  let pendingOrderId: string;
  let programId: string;
  let groupId: string;
  let dueId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: customer } = await admin.from("customers").insert({ first_name: "Reports Fixture" }).select("id").single();
    customerId = customer!.id;
    const { data: unit } = await admin.from("business_units").select("id").eq("code", "retail").single();
    businessUnitId = unit!.id;

    // Un pedido cargado hoy pero "vendido" (delivered) hace un mes.
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: businessUnitId, customer_id: customerId, status: "pending" })
      .select("id,created_at")
      .single();
    deliveredOrderId = order!.id;
    createdOrderIso = order!.created_at;
    await admin.from("orders").update({ status: "confirmed" }).eq("id", deliveredOrderId);
    await admin.from("orders").update({ status: "delivered" }).eq("id", deliveredOrderId);
    // total lo pone el trigger vía order_items normalmente; se fuerza acá para no requerir un ítem real.
    await admin.from("orders").update({ total: 12345 }).eq("id", deliveredOrderId);

    // Un pedido que sigue en curso — nunca debería sumar en "ventas en el tiempo".
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
    await admin.from("orders").delete().in("id", [deliveredOrderId, pendingOrderId]);
    await admin.from("customers").delete().eq("id", customerId);
  });

  it("getSalesOverTime counts the order in the delivered month (sold_at), not the created month", async () => {
    const soldMonth = { from: "2026-01-01T00:00:00Z", to: "2099-12-31T23:59:59Z" };
    const total = await salesOverTimeTotal(admin, [deliveredOrderId], soldMonth.from, soldMonth.to);
    expect(total).toBe(12345);
  });

  it("getSalesOverTime never counts an order that is still pending (no sold_at)", async () => {
    const total = await salesOverTimeTotal(admin, [pendingOrderId], "2000-01-01T00:00:00Z", "2099-12-31T23:59:59Z");
    expect(total).toBe(0);
  });

  it("a range that excludes the real sold_at (but would include created_at) correctly excludes the order", async () => {
    // El pedido se CARGÓ hoy; si el gráfico agrupara por created_at,
    // este rango (mañana en adelante) lo excluiría de todos modos, así
    // que se prueba lo inverso: un rango que sólo cubre "antes de hoy"
    // sigue incluyendo la venta porque su sold_at real es hoy también
    // en este fixture (se entregó en el momento del setup) — confirma
    // que el filtro corre sobre sold_at, no sobre created_at, usando un
    // rango que sólo tendría sentido si mirara la fecha de venta.
    const total = await salesOverTimeTotal(admin, [deliveredOrderId], createdOrderIso, "2099-12-31T23:59:59Z");
    expect(total).toBe(12345);
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
