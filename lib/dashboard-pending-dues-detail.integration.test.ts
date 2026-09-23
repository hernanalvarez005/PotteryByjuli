import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeDueDisplayStatus } from "./workshop-dues";
import { customerDisplayName } from "./customers-shared";
import { PENDING_DUES_DETAIL_LIMIT } from "./reports";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// el detalle accionable de "Necesita atención → cuotas pendientes"
// (perf audit, P1 — 2026-09-24): getDashboardSummary (lib/reports.ts)
// ya no trae TODAS las cuotas de la historia — cuenta con
// `count: "exact"` (nunca topeado) y trae sólo las
// PENDING_DUES_DETAIL_LIMIT más antiguas de `workshop_due_balances`
// (mismo criterio, deuda vieja primero). Mirror de esa lógica (no
// invocable directo: usa next/headers).
//
// Todos los fixtures de este archivo usan períodos de antes de 1950 —
// muy anteriores a cualquier dato realista de otros tests (que usan
// períodos ~2020-2026) — así que "las N más antiguas" siempre se puede
// verificar con certeza contra exactamente los ids que este archivo
// insertó, sin que la base compartida entre archivos de test en
// paralelo lo vuelva no determinístico.

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

/** Genera N períodos "YYYY-MM" consecutivos a partir de startYear-01. */
function periodsFrom(startYear: number, count: number): string[] {
  const periods: string[] = [];
  let y = startYear;
  let m = 1;
  for (let i = 0; i < count; i++) {
    periods.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return periods;
}

type PendingDueRow = {
  id: string;
  groupId: string;
  groupName: string;
  customerName: string;
  period: string;
  totalDue: number;
  paidTotal: number;
  balance: number;
  payments: { id: string; amount: number; paid_at: string; method_id: string | null; account_id: string | null; reference: string | null; notes: string | null }[];
};

/** Mirror exacto de la nueva lógica de getDashboardSummary (lib/reports.ts,
 * perf audit P1) — nunca invoca la función real (usa next/headers). */
async function pendingDuesSummary(admin: SupabaseClient): Promise<{ pendingDuesCount: number; pendingDuesDetail: PendingDueRow[] }> {
  const { count: pendingDuesCountRaw } = await admin
    .from("workshop_due_balances")
    .select("due_id", { count: "exact", head: true })
    .neq("status", "cancelled")
    .gt("balance", 0);

  const { data: pendingDueBalances } = await admin
    .from("workshop_due_balances")
    .select("due_id,enrollment_id,period,status,total_due,paid_total,balance")
    .neq("status", "cancelled")
    .gt("balance", 0)
    .order("period", { ascending: true })
    .limit(PENDING_DUES_DETAIL_LIMIT);

  const shownDueIds = (pendingDueBalances ?? []).map((d) => d.due_id as string);
  const shownEnrollmentIds = [...new Set((pendingDueBalances ?? []).map((d) => d.enrollment_id as string))];

  const [{ data: shownDuePayments }, { data: shownEnrollments }] = shownDueIds.length
    ? await Promise.all([
        admin
          .from("payments")
          .select("id,amount,paid_at,method_id,account_id,reference,notes,workshop_due_id")
          .in("workshop_due_id", shownDueIds),
        admin
          .from("workshop_enrollments")
          .select("id,group_id,customers(first_name,last_name),workshop_groups(name)")
          .in("id", shownEnrollmentIds),
      ])
    : [{ data: [] as never[] }, { data: [] as never[] }];

  const paymentsByDue = new Map<string, PendingDueRow["payments"]>();
  for (const p of (shownDuePayments ?? []) as { id: string; amount: number; paid_at: string; method_id: string | null; account_id: string | null; reference: string | null; notes: string | null; workshop_due_id: string }[]) {
    const list = paymentsByDue.get(p.workshop_due_id) ?? [];
    list.push({ id: p.id, amount: p.amount, paid_at: p.paid_at, method_id: p.method_id, account_id: p.account_id, reference: p.reference, notes: p.notes });
    paymentsByDue.set(p.workshop_due_id, list);
  }
  const enrollmentById = new Map(
    ((shownEnrollments ?? []) as unknown as {
      id: string;
      group_id: string;
      customers: { first_name: string; last_name: string | null } | null;
      workshop_groups: { name: string } | null;
    }[]).map((e) => [e.id, e])
  );

  const pendingDuesDetail: PendingDueRow[] = (pendingDueBalances ?? [])
    .filter((d) => {
      const displayStatus = computeDueDisplayStatus(d.status as "pending" | "cancelled", d.total_due as number, d.paid_total as number);
      return displayStatus === "pending" || displayStatus === "partial";
    })
    .map((d) => {
      const enrollment = enrollmentById.get(d.enrollment_id as string);
      return {
        id: d.due_id as string,
        groupId: enrollment?.group_id ?? "",
        groupName: enrollment?.workshop_groups?.name ?? "—",
        customerName: enrollment?.customers ? customerDisplayName(enrollment.customers) : "—",
        period: d.period as string,
        totalDue: d.total_due as number,
        paidTotal: d.paid_total as number,
        balance: d.balance as number,
        payments: paymentsByDue.get(d.due_id as string) ?? [],
      };
    });

  return { pendingDuesCount: pendingDuesCountRaw ?? 0, pendingDuesDetail };
}

describe.skipIf(!hasCredentials)("dashboard pending dues detail (local)", () => {
  let admin: SupabaseClient;
  let programId: string;
  let groupId: string;
  const customerIds: string[] = [];
  const enrollmentIds: string[] = [];
  const dueIds: string[] = [];

  // Referencia: sólo estos 4 dues participan de los tests de campos/
  // inclusión-exclusión básicos.
  let pendingDueId: string;
  let paidDueId: string;
  let cancelledDueId: string;
  let partialDueId: string;

  // Multi-cuota: una sola alumna con 3 cuotas pendientes.
  let multiCustomerId: string;
  const multiDueIds: string[] = [];

  // Bulk: 1200 cuotas pendientes bajo una sola inscripción — supera el
  // límite de página de PostgREST (1.000) por sí solo.
  const BULK_COUNT = 1200;
  let bulkEnrollmentId: string;
  let bulkDueIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    const { data: program } = await admin.from("workshop_programs").insert({ name: "Pending detail fixture P1" }).select("id").single();
    programId = program!.id;
    const { data: group } = await admin.from("workshop_groups").insert({ program_id: programId, name: "Grupo detalle P1", capacity: 2000 }).select("id").single();
    groupId = group!.id;

    // --- 4 fixtures básicos (uno de cada estado) ---
    const { data: pendingCustomer } = await admin.from("customers").insert({ first_name: "Pendiente", last_name: "FixtureP1" }).select("id").single();
    const { data: paidCustomer } = await admin.from("customers").insert({ first_name: "Pagada", last_name: "FixtureP1" }).select("id").single();
    const { data: cancelledCustomer } = await admin.from("customers").insert({ first_name: "Cancelada", last_name: "FixtureP1" }).select("id").single();
    const { data: partialCustomer } = await admin.from("customers").insert({ first_name: "Parcial", last_name: "FixtureP1" }).select("id").single();
    customerIds.push(pendingCustomer!.id, paidCustomer!.id, cancelledCustomer!.id, partialCustomer!.id);

    const { data: pendingEnrollment } = await admin.from("workshop_enrollments").insert({ group_id: groupId, customer_id: pendingCustomer!.id, status: "active" }).select("id").single();
    const { data: paidEnrollment } = await admin.from("workshop_enrollments").insert({ group_id: groupId, customer_id: paidCustomer!.id, status: "active" }).select("id").single();
    const { data: cancelledEnrollment } = await admin.from("workshop_enrollments").insert({ group_id: groupId, customer_id: cancelledCustomer!.id, status: "active" }).select("id").single();
    const { data: partialEnrollment } = await admin.from("workshop_enrollments").insert({ group_id: groupId, customer_id: partialCustomer!.id, status: "active" }).select("id").single();
    enrollmentIds.push(pendingEnrollment!.id, paidEnrollment!.id, cancelledEnrollment!.id, partialEnrollment!.id);

    // Períodos deliberadamente los MÁS viejos de todos — garantizan
    // aparecer primero en el "top N más antiguas", antes que el resto
    // de los fixtures de este archivo.
    const { data: pendingDue } = await admin.from("workshop_dues").insert({ enrollment_id: pendingEnrollment!.id, period: "1897-01", amount: 45000, status: "pending" }).select("id").single();
    pendingDueId = pendingDue!.id;

    const { data: paidDue } = await admin.from("workshop_dues").insert({ enrollment_id: paidEnrollment!.id, period: "1897-02", amount: 45000, status: "pending" }).select("id").single();
    paidDueId = paidDue!.id;
    await admin.from("payments").insert({ workshop_due_id: paidDueId, amount: 45000, paid_at: new Date().toISOString() });

    const { data: cancelledDue } = await admin.from("workshop_dues").insert({ enrollment_id: cancelledEnrollment!.id, period: "1897-03", amount: 30000, status: "cancelled" }).select("id").single();
    cancelledDueId = cancelledDue!.id;

    const { data: partialDue } = await admin.from("workshop_dues").insert({ enrollment_id: partialEnrollment!.id, period: "1897-04", amount: 20000, status: "pending" }).select("id").single();
    partialDueId = partialDue!.id;
    await admin.from("payments").insert({ workshop_due_id: partialDueId, amount: 8000, paid_at: new Date().toISOString() });

    dueIds.push(pendingDueId, paidDueId, cancelledDueId, partialDueId);

    // --- Multi-cuota: una alumna con 3 cuotas pendientes ---
    const { data: multiCustomer } = await admin.from("customers").insert({ first_name: "MultiCuota", last_name: "FixtureP1" }).select("id").single();
    multiCustomerId = multiCustomer!.id;
    customerIds.push(multiCustomerId);
    const { data: multiEnrollment } = await admin.from("workshop_enrollments").insert({ group_id: groupId, customer_id: multiCustomerId, status: "active" }).select("id").single();
    enrollmentIds.push(multiEnrollment!.id);
    for (const period of ["1899-01", "1899-02", "1899-03"]) {
      const { data: due } = await admin.from("workshop_dues").insert({ enrollment_id: multiEnrollment!.id, period, amount: 10000, status: "pending" }).select("id").single();
      multiDueIds.push(due!.id);
    }
    dueIds.push(...multiDueIds);

    // --- Bulk: 1200 cuotas pendientes, una sola inscripción ---
    const { data: bulkCustomer } = await admin.from("customers").insert({ first_name: "BulkScale", last_name: "FixtureP1" }).select("id").single();
    customerIds.push(bulkCustomer!.id);
    const { data: bulkEnrollment } = await admin.from("workshop_enrollments").insert({ group_id: groupId, customer_id: bulkCustomer!.id, status: "active" }).select("id").single();
    bulkEnrollmentId = bulkEnrollment!.id;
    enrollmentIds.push(bulkEnrollmentId);

    const bulkPeriods = periodsFrom(1900, BULK_COUNT); // 1900-01 .. muy posterior, 1200 meses
    const bulkRows = bulkPeriods.map((period) => ({ enrollment_id: bulkEnrollmentId, period, amount: 1000, status: "pending" as const }));
    const { data: created, error } = await admin.from("workshop_dues").insert(bulkRows).select("id");
    if (error) throw error;
    bulkDueIds = (created ?? []).map((d) => d.id as string);
    dueIds.push(...bulkDueIds);
  }, 30000);

  afterAll(async () => {
    await admin.from("payments").delete().in("workshop_due_id", dueIds);
    await admin.from("workshop_dues").delete().in("id", dueIds);
    await admin.from("workshop_enrollments").delete().in("id", enrollmentIds);
    await admin.from("customers").delete().in("id", customerIds);
    await admin.from("workshop_groups").delete().eq("id", groupId);
    await admin.from("workshop_programs").delete().eq("id", programId);
  }, 30000);

  it("incluye la cuota pendiente con Alumna/Grupo/Período/Total/Pagado/Pendiente correctos", async () => {
    const { pendingDuesDetail } = await pendingDuesSummary(admin);
    const row = pendingDuesDetail.find((d) => d.id === pendingDueId);
    expect(row).toBeTruthy();
    expect(row?.customerName).toBe("Pendiente FixtureP1");
    expect(row?.groupName).toBe("Grupo detalle P1");
    expect(row?.period).toBe("1897-01");
    expect(row?.totalDue).toBe(45000);
    expect(row?.paidTotal).toBe(0);
    expect(row?.balance).toBe(45000);
  });

  it("excluye una cuota totalmente pagada", async () => {
    const { pendingDuesDetail } = await pendingDuesSummary(admin);
    expect(pendingDuesDetail.some((d) => d.id === paidDueId)).toBe(false);
  });

  it("excluye una cuota cancelada, aunque tenga saldo sin cubrir", async () => {
    const { pendingDuesDetail } = await pendingDuesSummary(admin);
    expect(pendingDuesDetail.some((d) => d.id === cancelledDueId)).toBe(false);
  });

  it("incluye una cuota parcialmente pagada", async () => {
    const { pendingDuesDetail } = await pendingDuesSummary(admin);
    const row = pendingDuesDetail.find((d) => d.id === partialDueId);
    expect(row).toBeTruthy();
    expect(row?.totalDue).toBe(20000);
    expect(row?.paidTotal).toBe(8000);
    expect(row?.balance).toBe(12000);
  });

  it("una alumna con varias cuotas pendientes aparece varias veces — el conteo es de cuotas, nunca de personas", async () => {
    const { pendingDuesDetail } = await pendingDuesSummary(admin);
    const rows = pendingDuesDetail.filter((d) => multiDueIds.includes(d.id));
    expect(rows).toHaveLength(3); // 3 filas separadas, no 1 "por alumna"
    expect(rows.every((r) => r.customerName === "MultiCuota FixtureP1")).toBe(true);
    expect(new Set(rows.map((r) => r.period))).toEqual(new Set(["1899-01", "1899-02", "1899-03"]));
  });

  it("más de 1.000 cuotas históricas Y más de 1.000 pendientes: el conteo exacto lo refleja, nunca topeado en 1.000", async () => {
    const { pendingDuesCount } = await pendingDuesSummary(admin);
    // Nunca exactamente igual (la base es compartida entre archivos de
    // test en paralelo — otros también pueden tener dues pendientes) —
    // pero nunca menos que lo que este archivo garantiza por sí solo.
    expect(pendingDuesCount).toBeGreaterThan(1000);
    expect(pendingDuesCount).toBeGreaterThanOrEqual(BULK_COUNT + 5); // bulk + los 5 dues pendientes/parciales de los otros fixtures
  });

  it("el detalle nunca trae más de PENDING_DUES_DETAIL_LIMIT (50) filas, aunque haya miles pendientes", async () => {
    const { pendingDuesDetail } = await pendingDuesSummary(admin);
    expect(pendingDuesDetail.length).toBe(PENDING_DUES_DETAIL_LIMIT);
  });

  it("las 50 filas del detalle son realmente las 50 cuotas pendientes más antiguas — nunca un recorte arbitrario", async () => {
    const { pendingDuesDetail } = await pendingDuesSummary(admin);

    // Universo de períodos que ESTE archivo garantiza que están
    // incluidos (pending/partial, nunca paid/cancelled), ordenado.
    const includedPeriods = [
      "1897-01", // pendingDueId
      "1897-04", // partialDueId
      "1899-01",
      "1899-02",
      "1899-03", // multi-cuota
      ...periodsFrom(1900, BULK_COUNT),
    ].sort();
    const expectedOldest50 = includedPeriods.slice(0, PENDING_DUES_DETAIL_LIMIT);

    const actualPeriods = pendingDuesDetail.map((d) => d.period);
    expect(actualPeriods).toEqual(expectedOldest50);
    // Orden ascendente real, no sólo "el mismo set en cualquier orden".
    const sorted = [...actualPeriods].sort();
    expect(actualPeriods).toEqual(sorted);
  });
});
