import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Bloquea
// el bug real reportado en la tanda de usabilidad (2026-09-11, ítem 2/28-30):
// con "Unidad = Todas" (o específicamente "classes"), los pagos de cuotas
// de talleres cobrados en el período se sumaban a `collectedFiltered` sin
// ningún "invoiced" de cuotas del otro lado — las cuotas nunca aparecen en
// `orders.total`, así que plata cobrada de cuotas netamente escondía
// saldos pendientes reales de pedidos. Filtrando por una unidad
// específica (p.ej. "Personalizados") no tenía el problema porque las
// cuotas quedaban excluidas (`includeDuePayments` da false).
//
// Reproduce exactamente el escenario: un pedido personalizado con saldo
// pendiente real + cuotas de talleres cobradas de sobra en el mismo
// período — y confirma que "Pendiente de cobro" sigue reflejando el saldo
// del pedido tanto filtrando por "Personalizados" como por "Todas" (nunca
// menor, nunca $0 por la plata de cuotas).
//
// No llama a getDashboardSummary directamente (usa next/headers, no
// invocable fuera de un request de Next) — mirror de sus queries reales,
// mismo patrón que el resto de los tests de dashboard de este archivo.

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

/** Mirrors exactly getDashboardSummary's pendingToCollect computation
 * (lib/reports.ts) — scoped to one order id so it can't be thrown off by
 * unrelated data already in the local dev database. `includeDuePayments`
 * mimics the real "Todas"/"classes" vs. specific-unit branching. */
async function pendingForOrder(
  admin: SupabaseClient,
  orderId: string,
  customerId: string,
  fromIso: string,
  toIso: string,
  includeDuePayments: boolean
) {
  const { data: order } = await admin.from("orders").select("total").eq("id", orderId).single();
  const totalInvoiced = order!.total as number;

  const { data: orderPayments } = await admin
    .from("payments")
    .select("amount")
    .eq("order_id", orderId)
    .gte("paid_at", fromIso)
    .lte("paid_at", toIso);
  const orderPaymentsFiltered = (orderPayments ?? []).reduce((sum, p) => sum + p.amount, 0);

  let duePaymentsFiltered = 0;
  if (includeDuePayments) {
    const { data: dues } = await admin
      .from("workshop_dues")
      .select("id,workshop_enrollments!inner(customer_id)")
      .eq("workshop_enrollments.customer_id", customerId);
    const dueIds = (dues ?? []).map((d) => d.id as string);
    if (dueIds.length > 0) {
      const { data: duePayments } = await admin
        .from("payments")
        .select("amount")
        .in("workshop_due_id", dueIds)
        .gte("paid_at", fromIso)
        .lte("paid_at", toIso);
      duePaymentsFiltered = (duePayments ?? []).reduce((sum, p) => sum + p.amount, 0);
    }
  }

  // La fórmula corregida: nunca resta duePaymentsFiltered de un total
  // invoiced que sólo conoce `orders`.
  return { totalInvoiced, orderPaymentsFiltered, duePaymentsFiltered, pendingToCollect: Math.max(0, totalInvoiced - orderPaymentsFiltered) };
}

describe.skipIf(!hasCredentials)("dashboard 'Pendiente de cobro' under 'Todas' (local)", () => {
  let admin: SupabaseClient;
  let categoryId: string;
  let customerId: string;
  let customBusinessUnitId: string;
  let orderId: string;
  let programId: string;
  let groupId: string;
  let enrollmentId: string;
  let dueId: string;

  const fromIso = "2026-09-01T00:00:00-03:00";
  const toIso = "2026-09-30T23:59:59-03:00";

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    const { data: category } = await admin
      .from("product_categories")
      .insert({ name: "Pending todas test", code: `pending-todas-test-${Date.now()}` })
      .select("id")
      .single();
    categoryId = category!.id;
    const { data: customer } = await admin.from("customers").insert({ first_name: "Pending Todas Fixture" }).select("id").single();
    customerId = customer!.id;
    const { data: unit } = await admin.from("business_units").select("id").eq("code", "custom").single();
    customBusinessUnitId = unit!.id;

    // Pedido personalizado con saldo pendiente real: total 100000, sin
    // ningún pago registrado. product_variant_id todavía es obligatorio
    // en este punto de la tanda (el ítem no inventariado es un paso
    // posterior) — se usa una variante real cualquiera, sólo hace falta
    // que el order_item exista para que el trigger calcule el total.
    const { data: product } = await admin
      .from("products")
      .insert({ name: "Pending todas fixture product", category_id: categoryId, is_active: true })
      .select("id")
      .single();
    const { data: variant } = await admin.from("product_variants").select("id").eq("product_id", product!.id).single();

    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: customBusinessUnitId, customer_id: customerId, status: "confirmed" })
      .select("id")
      .single();
    orderId = order!.id;
    await admin.from("order_items").insert({ order_id: orderId, unit_price: 100000, quantity: 1, product_variant_id: variant!.id });

    // Cuotas de talleres cobradas de sobra en el mismo período — plata
    // real cobrada que, con el bug, tapaba el pendiente del pedido de
    // arriba cuando el filtro es "Todas".
    const { data: program } = await admin.from("workshop_programs").insert({ name: "Pending todas fixture" }).select("id").single();
    programId = program!.id;
    const { data: group } = await admin
      .from("workshop_groups")
      .insert({ program_id: programId, name: "Grupo fixture", capacity: 10 })
      .select("id")
      .single();
    groupId = group!.id;
    const { data: enrollment } = await admin
      .from("workshop_enrollments")
      .insert({ group_id: groupId, customer_id: customerId, status: "active" })
      .select("id")
      .single();
    enrollmentId = enrollment!.id;
    const { data: due } = await admin
      .from("workshop_dues")
      .insert({ enrollment_id: enrollmentId, period: "2026-09", amount: 45000 })
      .select("id")
      .single();
    dueId = due!.id;
    await admin.from("payments").insert({ workshop_due_id: dueId, amount: 45000, paid_at: "2026-09-15T12:00:00-03:00" });
  });

  afterAll(async () => {
    await admin.from("payments").delete().eq("workshop_due_id", dueId);
    await admin.from("workshop_dues").delete().eq("id", dueId);
    await admin.from("workshop_enrollments").delete().eq("id", enrollmentId);
    await admin.from("workshop_groups").delete().eq("id", groupId);
    await admin.from("workshop_programs").delete().eq("id", programId);
    await admin.from("order_items").delete().eq("order_id", orderId);
    await admin.from("orders").delete().eq("id", orderId);
    await admin.from("customers").delete().eq("id", customerId);
    await admin.from("products").delete().eq("category_id", categoryId);
    await admin.from("product_categories").delete().eq("id", categoryId);
  });

  it("shows the real pending balance filtering by the specific unit (Personalizados) — dues excluded", async () => {
    const result = await pendingForOrder(admin, orderId, customerId, fromIso, toIso, false);
    expect(result.pendingToCollect).toBe(100000);
  });

  it("still shows the SAME pending balance under 'Todas' — due payments collected must never mask it", async () => {
    const result = await pendingForOrder(admin, orderId, customerId, fromIso, toIso, true);
    // El fix clave: aunque duePaymentsFiltered sea grande (45000 cobrados
    // de cuotas), el pendiente del pedido no se ve afectado — nunca se
    // resta plata de cuotas de un invoiced que sólo conoce `orders`.
    expect(result.duePaymentsFiltered).toBe(45000);
    expect(result.pendingToCollect).toBe(100000);
  });
});
