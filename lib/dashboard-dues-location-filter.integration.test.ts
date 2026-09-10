import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Prueba
// la pieza más nueva y riesgosa de getDashboardSummary (lib/reports.ts,
// sección 8 — decisión de arquitectura 8 del plan): cuando el filtro de
// unidad de negocio es "Todas" o específicamente "classes" y hay además
// un filtro de ubicación activo, las cuotas de talleres sólo se incluyen
// si el grupo de la inscripción tiene esa location_id — vía un join
// anidado de 3 niveles (payments → workshop_dues → workshop_enrollments
// → workshop_groups.location_id) que PostgREST resuelve con `!inner` y
// un `.eq()` de ruta con puntos.

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

/** Mirrors exactly the nested-join query getDashboardSummary runs for
 * due-payments filtered by location. */
async function duePaymentsTotalForLocation(admin: SupabaseClient, locationId: string, fromIso: string, toIso: string) {
  const { data, error } = await admin
    .from("payments")
    .select("amount,workshop_dues!inner(workshop_enrollments!inner(workshop_groups!inner(location_id)))")
    .not("workshop_due_id", "is", null)
    .gte("paid_at", fromIso)
    .lte("paid_at", toIso)
    .eq("workshop_dues.workshop_enrollments.workshop_groups.location_id", locationId);
  if (error) throw error;
  return (data ?? []).reduce((sum, p) => sum + p.amount, 0);
}

describe.skipIf(!hasCredentials)("dashboard due-payments location filter (3-level nested join, local)", () => {
  let admin: SupabaseClient;
  let programId: string;
  let locationAId: string;
  let locationBId: string;
  let groupAId: string;
  let groupBId: string;
  let customerId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    const { data: program } = await admin.from("workshop_programs").insert({ name: "Fixture dashboard dues" }).select("id").single();
    programId = program!.id;

    const { data: locA } = await admin
      .from("locations")
      .insert({ code: `dashboard-test-a-${Date.now()}`, name: "Sede A test", location_type: "store" })
      .select("id")
      .single();
    locationAId = locA!.id;
    const { data: locB } = await admin
      .from("locations")
      .insert({ code: `dashboard-test-b-${Date.now()}`, name: "Sede B test", location_type: "store" })
      .select("id")
      .single();
    locationBId = locB!.id;

    const { data: groupA } = await admin
      .from("workshop_groups")
      .insert({ program_id: programId, location_id: locationAId, name: "Grupo A", capacity: 10 })
      .select("id")
      .single();
    groupAId = groupA!.id;
    const { data: groupB } = await admin
      .from("workshop_groups")
      .insert({ program_id: programId, location_id: locationBId, name: "Grupo B", capacity: 10 })
      .select("id")
      .single();
    groupBId = groupB!.id;

    const { data: customer } = await admin.from("customers").insert({ first_name: "Dashboard Dues Test" }).select("id").single();
    customerId = customer!.id;

    const { data: enrollA } = await admin
      .from("workshop_enrollments")
      .insert({ group_id: groupAId, customer_id: customerId, status: "active" })
      .select("id")
      .single();
    const { data: enrollB } = await admin
      .from("workshop_enrollments")
      .insert({ group_id: groupBId, customer_id: customerId, status: "active" })
      .select("id")
      .single();

    const { data: dueA } = await admin
      .from("workshop_dues")
      .insert({ enrollment_id: enrollA!.id, period: "2026-09", amount: 10000 })
      .select("id")
      .single();
    const { data: dueB } = await admin
      .from("workshop_dues")
      .insert({ enrollment_id: enrollB!.id, period: "2026-09", amount: 20000 })
      .select("id")
      .single();

    await admin.from("payments").insert([
      { workshop_due_id: dueA!.id, amount: 10000, paid_at: "2026-09-10T12:00:00-03:00" },
      { workshop_due_id: dueB!.id, amount: 20000, paid_at: "2026-09-10T12:00:00-03:00" },
    ]);
  });

  afterAll(async () => {
    const { data: enrollments } = await admin.from("workshop_enrollments").select("id").in("group_id", [groupAId, groupBId]);
    const enrollmentIds = (enrollments ?? []).map((e) => e.id);
    if (enrollmentIds.length) {
      const { data: dues } = await admin.from("workshop_dues").select("id").in("enrollment_id", enrollmentIds);
      const dueIds = (dues ?? []).map((d) => d.id);
      if (dueIds.length) await admin.from("payments").delete().in("workshop_due_id", dueIds);
      await admin.from("workshop_dues").delete().in("enrollment_id", enrollmentIds);
    }
    await admin.from("workshop_enrollments").delete().in("group_id", [groupAId, groupBId]);
    await admin.from("customers").delete().eq("id", customerId);
    await admin.from("workshop_groups").delete().in("id", [groupAId, groupBId]);
    await admin.from("locations").delete().in("id", [locationAId, locationBId]);
    await admin.from("workshop_programs").delete().eq("id", programId);
  });

  it("only sums due-payments whose enrollment's group is at the filtered location", async () => {
    const totalA = await duePaymentsTotalForLocation(admin, locationAId, "2026-09-01T00:00:00-03:00", "2026-09-30T23:59:59-03:00");
    expect(totalA).toBe(10000);

    const totalB = await duePaymentsTotalForLocation(admin, locationBId, "2026-09-01T00:00:00-03:00", "2026-09-30T23:59:59-03:00");
    expect(totalB).toBe(20000);
  });

  it("respects the paid_at date range on top of the location filter", async () => {
    const outsideRange = await duePaymentsTotalForLocation(admin, locationAId, "2026-10-01T00:00:00-03:00", "2026-10-31T23:59:59-03:00");
    expect(outsideRange).toBe(0);
  });
});
