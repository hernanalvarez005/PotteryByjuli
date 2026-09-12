import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeDueSummary } from "./workshop-dues";
import { customerDisplayName } from "./customers-shared";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// el detalle accionable de "Necesita atención → cuotas pendientes"
// (tanda de usabilidad, sección 12/13): getDashboardSummary
// (lib/reports.ts) construye pendingDuesDetail con exactamente
// Alumna/Grupo/Período/Total/Pagado/Pendiente + los pagos completos de
// cada cuota — mirror de esa query y ese mapeo (no invocable
// directamente: usa next/headers).

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

async function pendingDuesDetail(admin: SupabaseClient) {
  const { data: allDueRows } = await admin
    .from("workshop_dues")
    .select(
      "id,amount,status,period,payments(id,amount,paid_at,method_id,account_id,reference,notes),workshop_due_items(amount,voided_at),workshop_enrollments(group_id,customers(first_name,last_name),workshop_groups(name))"
    );

  return (allDueRows ?? [])
    .map((d) => {
      const payments = (d.payments ?? []) as { amount: number }[];
      const items = (d.workshop_due_items ?? []) as { amount: number; voided_at: string | null }[];
      const summary = computeDueSummary({ status: d.status as "pending" | "cancelled", amount: d.amount }, items, payments);
      const enrollment = d.workshop_enrollments as unknown as {
        group_id: string;
        customers: { first_name: string; last_name: string | null } | null;
        workshop_groups: { name: string } | null;
      } | null;
      return {
        id: d.id as string,
        groupId: enrollment?.group_id ?? "",
        groupName: enrollment?.workshop_groups?.name ?? "—",
        customerName: enrollment?.customers ? customerDisplayName(enrollment.customers) : "—",
        period: d.period as string,
        totalDue: summary.totalDue,
        paidTotal: summary.paidTotal,
        balance: summary.balance,
        status: summary.status,
      };
    })
    .filter((d) => d.status === "pending" || d.status === "partial");
}

describe.skipIf(!hasCredentials)("dashboard pending dues detail (local)", () => {
  let admin: SupabaseClient;
  let programId: string;
  let groupId: string;
  let pendingCustomerId: string;
  let paidCustomerId: string;
  let pendingDueId: string;
  let paidDueId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    const { data: program } = await admin.from("workshop_programs").insert({ name: "Pending detail fixture" }).select("id").single();
    programId = program!.id;
    const { data: group } = await admin
      .from("workshop_groups")
      .insert({ program_id: programId, name: "Grupo detalle", capacity: 10 })
      .select("id")
      .single();
    groupId = group!.id;

    const { data: pendingCustomer } = await admin.from("customers").insert({ first_name: "Pendiente", last_name: "Fixture" }).select("id").single();
    pendingCustomerId = pendingCustomer!.id;
    const { data: paidCustomer } = await admin.from("customers").insert({ first_name: "Pagada", last_name: "Fixture" }).select("id").single();
    paidCustomerId = paidCustomer!.id;

    const { data: pendingEnrollment } = await admin
      .from("workshop_enrollments")
      .insert({ group_id: groupId, customer_id: pendingCustomerId, status: "active" })
      .select("id")
      .single();
    const { data: paidEnrollment } = await admin
      .from("workshop_enrollments")
      .insert({ group_id: groupId, customer_id: paidCustomerId, status: "active" })
      .select("id")
      .single();

    const { data: pendingDue } = await admin
      .from("workshop_dues")
      .insert({ enrollment_id: pendingEnrollment!.id, period: "2026-09", amount: 45000 })
      .select("id")
      .single();
    pendingDueId = pendingDue!.id;

    const { data: paidDue } = await admin
      .from("workshop_dues")
      .insert({ enrollment_id: paidEnrollment!.id, period: "2026-09", amount: 45000 })
      .select("id")
      .single();
    paidDueId = paidDue!.id;
    await admin.from("payments").insert({ workshop_due_id: paidDueId, amount: 45000, paid_at: new Date().toISOString() });
  });

  afterAll(async () => {
    await admin.from("payments").delete().eq("workshop_due_id", paidDueId);
    await admin.from("workshop_dues").delete().in("id", [pendingDueId, paidDueId]);
    await admin.from("workshop_enrollments").delete().eq("group_id", groupId);
    await admin.from("customers").delete().in("id", [pendingCustomerId, paidCustomerId]);
    await admin.from("workshop_groups").delete().eq("id", groupId);
    await admin.from("workshop_programs").delete().eq("id", programId);
  });

  it("includes the pending due with correct Alumna/Grupo/Período/Total/Pagado/Pendiente", async () => {
    const detail = await pendingDuesDetail(admin);
    const row = detail.find((d) => d.id === pendingDueId);
    expect(row).toBeTruthy();
    expect(row?.customerName).toBe("Pendiente Fixture");
    expect(row?.groupName).toBe("Grupo detalle");
    expect(row?.period).toBe("2026-09");
    expect(row?.totalDue).toBe(45000);
    expect(row?.paidTotal).toBe(0);
    expect(row?.balance).toBe(45000);
  });

  it("excludes a fully-paid due", async () => {
    const detail = await pendingDuesDetail(admin);
    expect(detail.some((d) => d.id === paidDueId)).toBe(false);
  });
});
