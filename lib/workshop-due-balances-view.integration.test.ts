import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// la vista `workshop_due_balances` (perf audit, P1 — 2026-09-24) en
// aislamiento: confirma que su fórmula es idéntica, caso por caso, a
// computeDueSummary/computeDueBalance (lib/workshop-dues.ts) — nunca
// una segunda lógica financiera. Cero relación con getDashboardSummary
// todavía (eso lo cubre lib/dashboard-pending-dues-detail.integration.test.ts).

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

type BalanceRow = {
  due_id: string;
  enrollment_id: string;
  period: string;
  status: string;
  base_amount: number;
  extras_total: number;
  total_due: number;
  paid_total: number;
  balance: number;
};

describe.skipIf(!hasCredentials)("workshop_due_balances view (local)", () => {
  let admin: SupabaseClient;
  let customerId: string;
  let groupId: string;
  let programId: string;
  let enrollmentId: string;
  let conceptId: string;
  const dueIds: string[] = [];

  async function balanceOf(dueId: string): Promise<BalanceRow> {
    const { data, error } = await admin.from("workshop_due_balances").select("*").eq("due_id", dueId).single();
    if (error) throw error;
    return data as BalanceRow;
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: customer } = await admin.from("customers").insert({ first_name: "View Formula Fixture" }).select("id").single();
    customerId = customer!.id;
    const { data: program } = await admin.from("workshop_programs").insert({ name: "View formula program" }).select("id").single();
    programId = program!.id;
    const { data: group } = await admin.from("workshop_groups").insert({ program_id: programId, name: "Grupo formula", capacity: 10 }).select("id").single();
    groupId = group!.id;
    const { data: enrollment } = await admin
      .from("workshop_enrollments")
      .insert({ group_id: groupId, customer_id: customerId, status: "active" })
      .select("id")
      .single();
    enrollmentId = enrollment!.id;
    const { data: concept } = await admin
      .from("workshop_due_concepts")
      .insert({ code: `view-fixture-${Date.now()}`, name: "Fixture" })
      .select("id")
      .single();
    conceptId = concept!.id;
  });

  afterAll(async () => {
    await admin.from("payments").delete().in("workshop_due_id", dueIds);
    await admin.from("workshop_due_items").delete().in("due_id", dueIds);
    await admin.from("workshop_dues").delete().in("id", dueIds);
    await admin.from("workshop_due_concepts").delete().eq("id", conceptId);
    await admin.from("workshop_enrollments").delete().eq("id", enrollmentId);
    await admin.from("workshop_groups").delete().eq("id", groupId);
    await admin.from("workshop_programs").delete().eq("id", programId);
    await admin.from("customers").delete().eq("id", customerId);
  });

  it("extras anulados no suman al total_due — sólo los activos", async () => {
    const { data: due } = await admin
      .from("workshop_dues")
      .insert({ enrollment_id: enrollmentId, period: "2020-01", amount: 10000, status: "pending" })
      .select("id")
      .single();
    dueIds.push(due!.id);
    await admin.from("workshop_due_items").insert({ due_id: due!.id, concept_id: conceptId, amount: 1500, voided_at: null });
    await admin.from("workshop_due_items").insert({ due_id: due!.id, concept_id: conceptId, amount: 800, voided_at: new Date().toISOString() });

    const row = await balanceOf(due!.id);
    expect(row.base_amount).toBe(10000);
    expect(row.extras_total).toBe(1500); // 800 anulado, nunca suma
    expect(row.total_due).toBe(11500);
  });

  it("pagos parciales: paid_total suma todos los pagos, balance = total_due - paid_total", async () => {
    const { data: due } = await admin
      .from("workshop_dues")
      .insert({ enrollment_id: enrollmentId, period: "2020-02", amount: 11500, status: "pending" })
      .select("id")
      .single();
    dueIds.push(due!.id);
    await admin.from("payments").insert({ workshop_due_id: due!.id, amount: 3000, paid_at: new Date().toISOString() });
    await admin.from("payments").insert({ workshop_due_id: due!.id, amount: 2000, paid_at: new Date().toISOString() });

    const row = await balanceOf(due!.id);
    expect(row.paid_total).toBe(5000);
    expect(row.balance).toBe(6500);
  });

  it("sobrepago: balance nunca queda negativo, se clampea a 0 (igual que computeDueBalance)", async () => {
    const { data: due } = await admin
      .from("workshop_dues")
      .insert({ enrollment_id: enrollmentId, period: "2020-03", amount: 5000, status: "pending" })
      .select("id")
      .single();
    dueIds.push(due!.id);
    await admin.from("payments").insert({ workshop_due_id: due!.id, amount: 7000, paid_at: new Date().toISOString() });

    const row = await balanceOf(due!.id);
    expect(row.balance).toBe(0);
  });

  it("cuota sin ningún pago: balance = total_due completo, sin importar la antigüedad del período", async () => {
    const { data: due } = await admin
      .from("workshop_dues")
      .insert({ enrollment_id: enrollmentId, period: "2015-01", amount: 8000, status: "pending" })
      .select("id")
      .single();
    dueIds.push(due!.id);

    const row = await balanceOf(due!.id);
    expect(row.paid_total).toBe(0);
    expect(row.balance).toBe(8000);
  });

  it("due cancelado: la vista sigue exponiendo su balance real — no decide inclusión, sólo expone números", async () => {
    const { data: due } = await admin
      .from("workshop_dues")
      .insert({ enrollment_id: enrollmentId, period: "2020-04", amount: 9000, status: "cancelled" })
      .select("id")
      .single();
    dueIds.push(due!.id);

    const row = await balanceOf(due!.id);
    expect(row.status).toBe("cancelled");
    expect(row.balance).toBe(9000); // el filtro status<>'cancelled' lo aplica el consumidor, no la vista
  });

  it("no multiplica filas al agregar payments + workshop_due_items (2 pagos + 2 extras = 1 fila, no 4)", async () => {
    const { data: due } = await admin
      .from("workshop_dues")
      .insert({ enrollment_id: enrollmentId, period: "2020-05", amount: 6000, status: "pending" })
      .select("id")
      .single();
    dueIds.push(due!.id);
    await admin.from("workshop_due_items").insert({ due_id: due!.id, concept_id: conceptId, amount: 500, voided_at: null });
    await admin.from("workshop_due_items").insert({ due_id: due!.id, concept_id: conceptId, amount: 300, voided_at: null });
    await admin.from("payments").insert({ workshop_due_id: due!.id, amount: 1000, paid_at: new Date().toISOString() });
    await admin.from("payments").insert({ workshop_due_id: due!.id, amount: 500, paid_at: new Date().toISOString() });

    const { data, error } = await admin.from("workshop_due_balances").select("due_id").eq("due_id", due!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const row = await balanceOf(due!.id);
    expect(row.extras_total).toBe(800);
    expect(row.paid_total).toBe(1500);
    expect(row.total_due).toBe(6800);
    expect(row.balance).toBe(5300);
  });
});
