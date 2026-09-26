import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeDueSummary, DUE_WAIVERS_SELECT, type DueWaiverLike } from "./workshop-dues";

// Exención de la cuota base (workshop_due_waivers, waive_due / unwaive_due, vista
// workshop_due_balances y trigger de pagos) contra Supabase LOCAL real, con la
// sesión de cada rol. Los períodos son 200X-MM: más viejos que los de cualquier
// otra suite, así entran en el detalle de "Necesita atención" (las 50 más antiguas).

let currentClient: SupabaseClient;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => currentClient }));
const { getDashboardSummary, allTimeDashboardFilters } = await import("./reports");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";
type Role = "owner" | "operations" | "viewer";
const EMAILS: Record<Role, string> = {
  owner: "owner-test@pottery.local",
  operations: "operations-test@pottery.local",
  viewer: "viewer-test@pottery.local",
};
const RUN = Date.now().toString(36);

describe("exención de la cuota base (local)", { timeout: 30000 }, () => {
  let admin: SupabaseClient;
  const clients = {} as Record<Role, SupabaseClient>;
  const ids = {} as Record<Role, string>;
  let customerId: string;
  let programId: string;
  let groupId: string;
  let enrollmentId: string;
  let conceptId: string;
  let paymentMethodId: string;
  const dueIds: string[] = [];
  const orderIds: string[] = [];
  let periodCounter = 0;

  async function signIn(role: Role) {
    const { data: users } = await admin.auth.admin.listUsers();
    let id = users.users.find((u) => u.email === EMAILS[role])?.id;
    if (!id) {
      const { data: created, error } = await admin.auth.admin.createUser({ email: EMAILS[role], password: PASSWORD, email_confirm: true });
      if (error) throw error;
      id = created.user!.id;
      await admin.from("user_roles").insert({ user_id: id, role });
    }
    const c = createClient(SUPABASE_URL, ANON_KEY);
    const { error } = await c.auth.signInWithPassword({ email: EMAILS[role], password: PASSWORD });
    if (error) throw error;
    clients[role] = c;
    ids[role] = id;
  }

  /** Cuota nueva de un período único 200X-MM (no choca con otras suites ni consigo misma). */
  async function newDue(amount = 50000, status: "pending" | "cancelled" = "pending") {
    const n = periodCounter++;
    const period = `${2001 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
    const { data, error } = await admin.from("workshop_dues").insert({ enrollment_id: enrollmentId, period, amount, status }).select("id").single();
    if (error) throw error;
    dueIds.push(data.id);
    return data.id as string;
  }
  const addExtra = async (dueId: string, amount: number, voided = false) => {
    const { error } = await admin.from("workshop_due_items").insert({ due_id: dueId, concept_id: conceptId, amount, voided_at: voided ? new Date().toISOString() : null });
    if (error) throw error;
  };
  const pay = (client: SupabaseClient, dueId: string, amount: number) =>
    client.from("payments").insert({ workshop_due_id: dueId, amount, paid_at: new Date().toISOString(), method_id: paymentMethodId });
  const waive = (dueId: string, reason: string | null = null, role: Role = "owner") =>
    clients[role].rpc("waive_due", { p_due_id: dueId, p_reason: reason });
  const unwaive = (dueId: string, reason: string | null = null, role: Role = "owner") =>
    clients[role].rpc("unwaive_due", { p_due_id: dueId, p_reason: reason });
  const waivers = async (dueId: string) =>
    (await admin.from("workshop_due_waivers").select("*").eq("due_id", dueId).order("waived_at")).data ?? [];
  const paymentsCount = async (dueId: string) =>
    (await admin.from("payments").select("*", { count: "exact", head: true }).eq("workshop_due_id", dueId)).count ?? 0;
  const balanceRow = async (dueId: string) => {
    const { data, error } = await admin.from("workshop_due_balances").select("*").eq("due_id", dueId).single();
    if (error) throw error;
    return { ...data, total_due: Number(data.total_due), paid_total: Number(data.paid_total), balance: Number(data.balance), extras_total: Number(data.extras_total) };
  };

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    for (const role of ["owner", "operations", "viewer"] as Role[]) await signIn(role);
    customerId = (await admin.from("customers").insert({ first_name: `ZZExencion ${RUN}` }).select("id").single()).data!.id;
    programId = (await admin.from("workshop_programs").insert({ name: `ZZ programa exención ${RUN}` }).select("id").single()).data!.id;
    groupId = (await admin.from("workshop_groups").insert({ program_id: programId, name: `ZZ grupo exención ${RUN}`, capacity: 10 }).select("id").single()).data!.id;
    enrollmentId = (await admin.from("workshop_enrollments").insert({ group_id: groupId, customer_id: customerId, status: "active" }).select("id").single()).data!.id;
    conceptId = (await admin.from("workshop_due_concepts").insert({ code: `zz-waiver-${RUN}`, name: "Arcilla fixture" }).select("id").single()).data!.id;
    paymentMethodId = (await admin.from("payment_methods").select("id").limit(1).single()).data!.id;
  });

  afterAll(async () => {
    if (orderIds.length) await admin.from("orders").delete().in("id", orderIds);
    await admin.from("payments").delete().in("workshop_due_id", dueIds);
    await admin.from("workshop_due_items").delete().in("due_id", dueIds);
    await admin.from("workshop_dues").delete().in("id", dueIds); // cascada: workshop_due_waivers
    await admin.from("workshop_due_concepts").delete().eq("id", conceptId);
    await admin.from("workshop_enrollments").delete().eq("id", enrollmentId);
    await admin.from("workshop_groups").delete().eq("id", groupId);
    await admin.from("workshop_programs").delete().eq("id", programId);
    await admin.from("customers").delete().eq("id", customerId);
  });

  describe("eximir", () => {
    it("el owner crea un ciclo: quién, cuándo, motivo (recortado) e importe base congelado", async () => {
      const due = await newDue(50000);
      const before = Date.now();
      const { data, error } = await waive(due, "  convenio con la escuela  ");
      expect(error).toBeNull();

      const [row] = await waivers(due);
      expect(row).toMatchObject({ id: data, due_id: due, reason: "convenio con la escuela", waived_by: ids.owner, reverted_at: null, reverted_by: null, revert_reason: null });
      expect(Number(row.waived_amount)).toBe(50000);
      expect(new Date(row.waived_at).getTime()).toBeGreaterThanOrEqual(before - 2000);
    });

    it("el motivo es opcional", async () => {
      const due = await newDue();
      expect((await waive(due)).error).toBeNull();
      expect((await waivers(due))[0].reason).toBeNull();
    });

    it("NO crea ningún pago ni ingreso (no es un pago de $0)", async () => {
      const due = await newDue();
      await waive(due, "cortesía");
      expect(await paymentsCount(due)).toBe(0);
      await unwaive(due);
      expect(await paymentsCount(due)).toBe(0);
    });

    it("sólo owner: operations y viewer no pueden eximir", async () => {
      const due = await newDue();
      for (const role of ["operations", "viewer"] as Role[]) {
        expect((await waive(due, null, role)).error?.message).toMatch(/Sólo la administradora/);
      }
      expect(await waivers(due)).toHaveLength(0);
    });

    it("rechaza: cuota cancelada, sin importe base, ya exenta, inexistente y motivo largo", async () => {
      const cancelled = await newDue(50000, "cancelled");
      expect((await waive(cancelled)).error?.message).toMatch(/cancelada/);

      const zero = await newDue(0);
      expect((await waive(zero)).error?.message).toMatch(/sin importe base|no tiene importe/);

      const twice = await newDue();
      await waive(twice);
      expect((await waive(twice)).error?.message).toMatch(/ya está exenta/);
      expect(await waivers(twice)).toHaveLength(1);

      expect((await waive("00000000-0000-4000-8000-000000000000")).error?.message).toMatch(/no existe/);

      const long = await newDue();
      expect((await waive(long, "x".repeat(301))).error).not.toBeNull();
      expect(await waivers(long)).toHaveLength(0);
    });

    it("CUALQUIER pago existente bloquea la exención (parcial o total), sin cambiar nada", async () => {
      const partial = await newDue(50000);
      await pay(admin, partial, 1000);
      expect((await waive(partial)).error?.message).toMatch(/ya tiene pagos registrados/);
      expect(await waivers(partial)).toHaveLength(0);

      const full = await newDue(50000);
      await pay(admin, full, 50000);
      expect((await waive(full)).error?.message).toMatch(/ya tiene pagos registrados/);
      expect(await paymentsCount(full)).toBe(1);
    });
  });

  describe("quitar la exención y ciclos", () => {
    it("cierra el ciclo (quién, cuándo, motivo) SIN borrar la fila", async () => {
      const due = await newDue();
      await waive(due, "convenio");
      const { error } = await unwaive(due, "cargada por error");
      expect(error).toBeNull();

      const rows = await waivers(due);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ reason: "convenio", waived_by: ids.owner, reverted_by: ids.owner, revert_reason: "cargada por error" });
      expect(rows[0].reverted_at).not.toBeNull();
      expect(new Date(rows[0].reverted_at).getTime()).toBeGreaterThanOrEqual(new Date(rows[0].waived_at).getTime());
    });

    it("múltiples ciclos eximir/quitar: una fila por ciclo, historial completo", async () => {
      const due = await newDue();
      for (const reason of ["primera", "segunda", "tercera"]) {
        expect((await waive(due, reason)).error).toBeNull();
        if (reason !== "tercera") expect((await unwaive(due, `quitada ${reason}`)).error).toBeNull();
      }
      const rows = await waivers(due);
      expect(rows.map((r) => r.reason)).toEqual(["primera", "segunda", "tercera"]);
      expect(rows.map((r) => r.reverted_at !== null)).toEqual([true, true, false]); // sólo la última sigue activa
      expect(rows.filter((r) => r.reverted_at === null)).toHaveLength(1);
    });

    it("sólo owner puede quitar; sin exención activa se rechaza", async () => {
      const due = await newDue();
      await waive(due);
      for (const role of ["operations", "viewer"] as Role[]) {
        expect((await unwaive(due, null, role)).error?.message).toMatch(/Sólo la administradora/);
      }
      expect((await waivers(due))[0].reverted_at).toBeNull();

      const none = await newDue();
      expect((await unwaive(none)).error?.message).toMatch(/no tiene una exención activa/);
    });

    it("el índice único parcial impide DOS exenciones activas de la misma cuota", async () => {
      const due = await newDue();
      await waive(due);
      const { error } = await admin.from("workshop_due_waivers").insert({ due_id: due, waived_amount: 1, waived_by: ids.owner });
      expect(error?.code).toBe("23505");
    });
  });

  describe("el historial es inmutable por la API", () => {
    it("nadie (ni la owner) puede insertar, editar ni borrar filas directamente", async () => {
      const due = await newDue();
      await waive(due, "original");
      const [row] = await waivers(due);

      for (const role of ["owner", "operations", "viewer"] as Role[]) {
        const insert = await clients[role].from("workshop_due_waivers").insert({ due_id: due, waived_amount: 1, waived_by: ids[role] });
        expect(insert.error).not.toBeNull();
        await clients[role].from("workshop_due_waivers").update({ reason: "editada", waived_amount: 999 }).eq("id", row.id);
        await clients[role].from("workshop_due_waivers").delete().eq("id", row.id);
      }
      const [after] = await waivers(due);
      expect(after).toMatchObject({ id: row.id, reason: "original", reverted_at: null });
      expect(Number(after.waived_amount)).toBe(50000);
    });

    it("todos los roles autenticados LEEN el historial; anon no", async () => {
      const due = await newDue();
      await waive(due, "visible");
      for (const role of ["owner", "operations", "viewer"] as Role[]) {
        const { data } = await clients[role].from("workshop_due_waivers").select("reason").eq("due_id", due);
        expect(data).toEqual([{ reason: "visible" }]);
      }
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      expect((await anon.from("workshop_due_waivers").select("id").eq("due_id", due)).data ?? []).toHaveLength(0);
    });
  });

  describe("los extras siguen cobrables", () => {
    it("un extra sobre una cuota exenta suma sólo el extra; anularlo la deja en 0", async () => {
      const due = await newDue(50000);
      await waive(due);
      await addExtra(due, 8000);
      expect(await balanceRow(due)).toMatchObject({ base_amount: 50000, extras_total: 8000, total_due: 8000, balance: 8000, base_waived: true });

      const { data: item } = await admin.from("workshop_due_items").select("id").eq("due_id", due).single();
      expect((await clients.owner.rpc("void_due_item", { p_id: item!.id })).error).toBeNull();
      expect(await balanceRow(due)).toMatchObject({ total_due: 0, balance: 0, base_waived: true });
    });
  });

  describe("pagos sobre cuotas exentas — trigger acotado a pagos de cuota", () => {
    it("exenta SIN saldo: el pago se rechaza con un mensaje claro y no se inserta", async () => {
      const due = await newDue();
      await waive(due);
      const { error } = await pay(clients.operations, due, 100);
      expect(error?.message).toMatch(/exenta y no tiene saldo por cobrar/);
      expect(await paymentsCount(due)).toBe(0);
    });

    it("exenta CON extras pendientes: se puede cobrar el extra; cuando el saldo llega a 0 se rechaza el siguiente", async () => {
      const due = await newDue();
      await waive(due);
      await addExtra(due, 8000);
      expect((await pay(clients.operations, due, 5000)).error).toBeNull();
      expect((await pay(clients.operations, due, 3000)).error).toBeNull();
      expect((await balanceRow(due)).balance).toBe(0);
      expect((await pay(clients.operations, due, 1)).error?.message).toMatch(/exenta y no tiene saldo/);
      expect(await paymentsCount(due)).toBe(2);
    });

    it("una cuota NO exenta no cambia: incluso un sobrepago se acepta como siempre", async () => {
      const due = await newDue(1000);
      expect((await pay(clients.operations, due, 1000)).error).toBeNull();
      expect((await pay(clients.operations, due, 500)).error).toBeNull();
    });

    it("después de QUITAR la exención se vuelve a poder cobrar la base", async () => {
      const due = await newDue(1000);
      await waive(due);
      expect((await pay(clients.operations, due, 100)).error).not.toBeNull();
      await unwaive(due);
      expect((await pay(clients.operations, due, 100)).error).toBeNull();
    });

    it("corregir un pago existente (UPDATE) no lo dispara: el trigger es sólo BEFORE INSERT", async () => {
      const due = await newDue(1000);
      await pay(admin, due, 400);
      const { data: p } = await admin.from("payments").select("id").eq("workshop_due_id", due).single();
      expect((await clients.operations.from("payments").update({ amount: 450 }).eq("id", p!.id)).error).toBeNull();
    });

    it("NO afecta a otros dominios: los pagos de pedidos siguen entrando igual", async () => {
      const unitId = (await admin.from("business_units").select("id").eq("code", "retail").single()).data!.id;
      const { data: order } = await admin.from("orders").insert({ business_unit_id: unitId, operation_type: "order", total: 100 }).select("id").single();
      orderIds.push(order!.id);
      const { error } = await clients.operations.from("payments").insert({ order_id: order!.id, amount: 100, paid_at: new Date().toISOString() });
      expect(error).toBeNull();
    });

    it("el trigger está acotado por WHEN (workshop_due_id is not null): pedidos y ventas ni lo evalúan", () => {
      const sql = readFileSync(path.resolve(__dirname, "../supabase/migrations/20260926110000_workshop_due_waivers.sql"), "utf-8").toLowerCase();
      expect(sql).toMatch(/before insert on public\.payments[\s\S]*when \(new\.workshop_due_id is not null\)/);
      expect(sql).not.toMatch(/after update on public\.payments/);
    });

    it("carrera exención vs pago: nunca queda una exención activa CON un pago sobre la misma cuota", async () => {
      for (let i = 0; i < 6; i++) {
        const due = await newDue();
        await Promise.all([waive(due), pay(admin, due, 10)]);
        const active = (await waivers(due)).filter((w) => w.reverted_at === null).length;
        const payments = await paymentsCount(due);
        expect(active === 1 && payments > 0).toBe(false);
        expect(active + payments).toBeGreaterThan(0);
      }
    });
  });

  describe("cancelar una cuota exenta", () => {
    it("queda 'cancelled' y el ciclo se conserva en el historial", async () => {
      const due = await newDue();
      await waive(due, "antes de cancelar");
      expect((await clients.owner.rpc("cancel_due", { p_id: due })).error).toBeNull();
      expect(await waivers(due)).toHaveLength(1);
      expect((await balanceRow(due)).status).toBe("cancelled");
    });
  });

  describe("workshop_due_balances replica EXACTAMENTE computeDueSummary", () => {
    type Scenario = {
      name: string;
      amount: number;
      extras?: { amount: number; voided?: boolean }[];
      payments?: number[];
      // Ciclos a ejecutar en orden: 'waive' | 'unwaive'
      cycle?: ("waive" | "unwaive")[];
      cancelled?: boolean;
    };
    const scenarios: Scenario[] = [
      { name: "sin exención, sin nada", amount: 50000 },
      { name: "sin exención, pago parcial + extra", amount: 50000, extras: [{ amount: 8000 }], payments: [20000] },
      { name: "sin exención, sobrepago", amount: 5000, payments: [7000] },
      { name: "exenta, sin extras", amount: 50000, cycle: ["waive"] },
      { name: "exenta, extra pendiente", amount: 50000, extras: [{ amount: 8000 }], cycle: ["waive"] },
      { name: "exenta, extra con pago parcial", amount: 50000, extras: [{ amount: 8000 }], cycle: ["waive"], payments: [3000] },
      { name: "exenta, extra pagado completo", amount: 50000, extras: [{ amount: 8000 }], cycle: ["waive"], payments: [8000] },
      { name: "exenta, extra anulado", amount: 50000, extras: [{ amount: 8000, voided: true }], cycle: ["waive"] },
      { name: "exenta, un extra activo + uno anulado", amount: 50000, extras: [{ amount: 8000 }, { amount: 2000, voided: true }], cycle: ["waive"] },
      { name: "exenta y luego quitada", amount: 50000, cycle: ["waive", "unwaive"] },
      { name: "exenta, quitada y exenta otra vez", amount: 50000, cycle: ["waive", "unwaive", "waive"] },
      { name: "extra pagado y DESPUÉS se quita la exención", amount: 50000, extras: [{ amount: 8000 }], cycle: ["waive", "unwaive"], payments: [8000] },
      { name: "cancelada con exención", amount: 50000, cycle: ["waive"], cancelled: true },
    ];

    for (const sc of scenarios) {
      it(sc.name, async () => {
        const due = await newDue(sc.amount);
        for (const e of sc.extras ?? []) await addExtra(due, e.amount, e.voided);
        // Orden real: primero eximir (con extras ya cargados), luego pagos, luego el resto del ciclo.
        const cycle = sc.cycle ?? [];
        if (cycle[0] === "waive") expect((await waive(due)).error).toBeNull();
        for (const amount of sc.payments ?? []) expect((await pay(admin, due, amount)).error).toBeNull();
        for (const step of cycle.slice(1)) expect((await (step === "waive" ? waive(due) : unwaive(due))).error).toBeNull();
        if (sc.cancelled) await clients.owner.rpc("cancel_due", { p_id: due });

        // Lo que ve la app (computeDueSummary con las filas crudas)…
        const { data: raw } = await admin
          .from("workshop_dues")
          .select(`amount,status,payments(amount),workshop_due_items(amount,voided_at),${DUE_WAIVERS_SELECT}`)
          .eq("id", due)
          .single();
        const summary = computeDueSummary(
          { status: raw!.status as "pending" | "cancelled", amount: raw!.amount as number },
          (raw!.workshop_due_items ?? []) as { amount: number; voided_at: string | null }[],
          (raw!.payments ?? []) as { amount: number }[],
          (raw!.workshop_due_waivers ?? []) as DueWaiverLike[]
        );
        // …tiene que ser EXACTAMENTE lo que expone la vista.
        const view = await balanceRow(due);
        expect(view.total_due).toBe(summary.totalDue);
        expect(view.paid_total).toBe(summary.paidTotal);
        expect(view.balance).toBe(summary.balance);
        expect(view.extras_total).toBe(summary.extrasTotal);
        expect(view.base_waived).toBe(summary.baseWaived);
      });
    }
  });

  describe("dashboard y reportes", () => {
    it("'Necesita atención': una exenta sin extras NO aparece; con extras pendientes aparece sólo por el extra", async () => {
      const exemptOnly = await newDue(50000);
      await waive(exemptOnly);
      const exemptWithExtra = await newDue(50000);
      await waive(exemptWithExtra);
      await addExtra(exemptWithExtra, 8000);
      const plain = await newDue(30000);

      currentClient = clients.owner;
      const summary = await getDashboardSummary(allTimeDashboardFilters());
      const detail = new Map(summary.pendingDuesDetail.map((d) => [d.id, d]));

      expect(detail.has(exemptOnly)).toBe(false);
      expect(detail.get(exemptWithExtra)).toMatchObject({ totalDue: 8000, paidTotal: 0, balance: 8000 });
      expect(detail.get(plain)).toMatchObject({ totalDue: 30000, balance: 30000 });
    });

    it("la exención NO suma ingreso: 'cobrado' del dashboard no cambia al eximir ni al quitar", async () => {
      const due = await newDue(50000);
      currentClient = clients.owner;
      const before = await getDashboardSummary(allTimeDashboardFilters());
      await waive(due, "sin ingreso");
      const during = await getDashboardSummary(allTimeDashboardFilters());
      await unwaive(due);
      const after = await getDashboardSummary(allTimeDashboardFilters());
      // Sólo pagos reales suman: ninguno de los tres cambia por un ciclo de exención.
      expect(during.collectedFiltered).toBe(before.collectedFiltered);
      expect(after.collectedFiltered).toBe(before.collectedFiltered);
      expect(await paymentsCount(due)).toBe(0);
    });
  });
});
