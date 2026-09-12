import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// el multi-select de unidades de negocio del Dashboard (tanda de
// usabilidad, secciones 31-33): mirror de filteredOrdersQuery
// (lib/reports.ts, getDashboardSummary) con `.in("business_unit_id",
// ids)` en vez de `.eq()` — 2/3 unidades seleccionadas deben sumar
// exactamente sus partes, y "Todas" (sin filtro) debe incluir todo.

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

async function invoicedTotal(admin: SupabaseClient, businessUnitIds: string[] | null, orderIds: string[]) {
  let query = admin.from("orders").select("id,total").neq("status", "cancelled").in("id", orderIds);
  if (businessUnitIds) query = query.in("business_unit_id", businessUnitIds);
  const { data } = await query;
  return (data ?? []).reduce((sum, o) => sum + o.total, 0);
}

describe.skipIf(!hasCredentials)("dashboard business unit multi-select (local)", () => {
  let admin: SupabaseClient;
  let customerId: string;
  let retailId: string;
  let wholesaleId: string;
  let customId: string;
  const orderIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: customer } = await admin.from("customers").insert({ first_name: "Multiselect Fixture" }).select("id").single();
    customerId = customer!.id;

    const { data: retail } = await admin.from("business_units").select("id").eq("code", "retail").single();
    retailId = retail!.id;
    const { data: wholesale } = await admin.from("business_units").select("id").eq("code", "wholesale").single();
    wholesaleId = wholesale!.id;
    const { data: custom } = await admin.from("business_units").select("id").eq("code", "custom").single();
    customId = custom!.id;

    for (const [unitId, total] of [
      [retailId, 1000],
      [wholesaleId, 2000],
      [customId, 4000],
    ] as [string, number][]) {
      const { data: order } = await admin
        .from("orders")
        .insert({ business_unit_id: unitId, customer_id: customerId, status: "delivered" })
        .select("id")
        .single();
      orderIds.push(order!.id);
      // El total real lo pone el trigger vía order_items — se fuerza acá
      // directamente para no tener que armar un ítem real por unidad.
      await admin.from("orders").update({ total }).eq("id", order!.id);
    }
  });

  afterAll(async () => {
    await admin.from("orders").delete().in("id", orderIds);
    await admin.from("customers").delete().eq("id", customerId);
  });

  it("a single selected unit matches exactly that unit's total", async () => {
    expect(await invoicedTotal(admin, [retailId], orderIds)).toBe(1000);
    expect(await invoicedTotal(admin, [wholesaleId], orderIds)).toBe(2000);
  });

  it("two selected units sum exactly their two parts — never less", async () => {
    const total = await invoicedTotal(admin, [retailId, wholesaleId], orderIds);
    expect(total).toBe(1000 + 2000);
  });

  it("three selected units sum exactly their three parts", async () => {
    const total = await invoicedTotal(admin, [retailId, wholesaleId, customId], orderIds);
    expect(total).toBe(1000 + 2000 + 4000);
  });

  it("'Todas' (no filter, null) includes everything — same as selecting every unit", async () => {
    const total = await invoicedTotal(admin, null, orderIds);
    expect(total).toBe(1000 + 2000 + 4000);
  });
});
