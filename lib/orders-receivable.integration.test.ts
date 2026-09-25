import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupFixtures } from "../tests/support/fixture-cleanup";

// "Pendiente de cobrar" (order_balances + get_orders_receivable) y el filtro por
// unidad de negocio de Lista/Kanban contra Supabase LOCAL real, con la sesión
// de cada rol. Cada corrida crea DOS unidades de negocio propias: el universo de
// cada filtro queda aislado de los miles de pedidos que ya hay en la base.

type Role = "owner" | "operations" | "viewer";
let currentClient: SupabaseClient;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => currentClient }));
const { getOrdersPage, getOrdersKanbanBoard, getOrdersReceivable } = await import("./orders");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";
const EMAILS: Record<Role, string> = {
  owner: "owner-test@pottery.local",
  operations: "operations-test@pottery.local",
  viewer: "viewer-test@pottery.local",
};
const RUN = Date.now().toString(36);

describe("pendiente de cobrar (local)", { timeout: 30000 }, () => {
  let admin: SupabaseClient;
  const clients = {} as Record<Role, SupabaseClient>;
  let unitA: string;
  let unitB: string;
  let customerId: string;
  const orderIds: string[] = [];
  const unitIds: string[] = [];

  async function signIn(role: Role) {
    const { data: users } = await admin.auth.admin.listUsers();
    if (!users.users.find((u) => u.email === EMAILS[role])) {
      const { data: created, error } = await admin.auth.admin.createUser({ email: EMAILS[role], password: PASSWORD, email_confirm: true });
      if (error) throw error;
      await admin.from("user_roles").insert({ user_id: created.user!.id, role });
    }
    const c = createClient(SUPABASE_URL, ANON_KEY);
    const { error } = await c.auth.signInWithPassword({ email: EMAILS[role], password: PASSWORD });
    if (error) throw error;
    clients[role] = c;
  }

  async function order(unitId: string, opts: { total: number; status?: string; paid?: number[]; archived?: boolean; operationType?: string }) {
    const { data, error } = await admin
      .from("orders")
      .insert({
        business_unit_id: unitId, customer_id: customerId, operation_type: opts.operationType ?? "order",
        status: opts.status ?? "confirmed", total: opts.total, archived_at: opts.archived ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (error) throw error;
    orderIds.push(data.id);
    for (const amount of opts.paid ?? []) {
      const { error: payError } = await admin.from("payments").insert({ order_id: data.id, amount, paid_at: new Date().toISOString() });
      if (payError) throw payError;
    }
    return data.id as string;
  }

  const receivable = async (unitId: string | null, role: Role = "owner") => {
    const { data, error } = await clients[role].rpc("get_orders_receivable", { p_business_unit_id: unitId });
    if (error) throw error;
    const row = (data as Record<string, string | number>[])[0];
    return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) as Record<string, number>;
  };

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    for (const role of ["owner", "operations", "viewer"] as Role[]) await signIn(role);
    for (const suffix of ["a", "b"]) {
      const { data } = await admin.from("business_units").insert({ code: `zz-recv-${RUN}-${suffix}`, name: `Unidad ${suffix.toUpperCase()} ${RUN}` }).select("id").single();
      unitIds.push(data!.id);
    }
    [unitA, unitB] = unitIds;
    customerId = (await admin.from("customers").insert({ first_name: `ZZRecv ${RUN}` }).select("id").single()).data!.id;
  });

  afterAll(async () => {
    await cleanupFixtures(admin, "orders-receivable", { orderIds, customerIds: [customerId] });
    await admin.from("business_units").delete().in("id", unitIds);
  });

  describe("saldo real: total − pagos, nunca sum(total)", () => {
    it("sin pagos = el total; con pago parcial = lo que falta; pagado completo = no cuenta", async () => {
      await order(unitA, { total: 1000 });
      await order(unitA, { total: 1000, paid: [400] });
      await order(unitA, { total: 1000, paid: [1000] });
      const r = await receivable(unitA);
      expect(r.pending_total).toBe(1600); // 1000 + 600, NO 3000
      expect(r.orders_count).toBe(2);
    });

    it("varios pagos de un mismo pedido se suman y el pedido cuenta UNA vez (sin multiplicar filas)", async () => {
      await order(unitB, { total: 900, paid: [100, 200, 300] });
      const r = await receivable(unitB);
      expect(r.pending_total).toBe(300);
      expect(r.orders_count).toBe(1);
    });

    it("un pedido SOBREPAGADO no compensa a otro (saldo mínimo 0 por pedido)", async () => {
      const { data: unit } = await admin.from("business_units").insert({ code: `zz-recv-${RUN}-over`, name: `Over ${RUN}` }).select("id").single();
      unitIds.push(unit!.id);
      await order(unit!.id, { total: 500, paid: [800] });
      await order(unit!.id, { total: 700 });
      expect((await receivable(unit!.id)).pending_total).toBe(700); // no 400
    });

    it("la vista order_balances expone paid_total y balance por pedido", async () => {
      const { data: u } = await admin.from("business_units").insert({ code: `zz-recv-${RUN}-view`, name: `VIEW ${RUN}` }).select("id").single();
      unitIds.push(u!.id);
      const id = await order(u!.id, { total: 250, paid: [50, 25] });
      const { data } = await admin.from("order_balances").select("paid_total,balance,total").eq("order_id", id).single();
      expect({ paid: Number(data!.paid_total), balance: Number(data!.balance), total: Number(data!.total) }).toEqual({ paid: 75, balance: 175, total: 250 });
    });
  });

  describe("universo", () => {
    let unit: string;
    beforeAll(async () => {
      const { data } = await admin.from("business_units").insert({ code: `zz-recv-${RUN}-uni`, name: `Universo ${RUN}` }).select("id").single();
      unit = data!.id;
      unitIds.push(unit);
    });

    it("EXCLUYE cancelados (aunque tengan saldo) e INCLUYE cada estado no cancelado, incluido entregado con deuda", async () => {
      await order(unit, { total: 100, status: "cancelled" });
      for (const [i, status] of ["pending", "confirmed", "in_production", "ready", "delivered"].entries()) {
        await order(unit, { total: 10 ** i * 1000, status });
      }
      const r = await receivable(unit);
      expect(r.pending_total).toBe(1000 + 10000 + 100000 + 1000000 + 10000000 - 0); // sin el cancelado de 100
      expect(r.orders_count).toBe(5);
    });

    it("EXCLUYE lo que no es un pedido (venta rápida `retail_sale`)", async () => {
      const { data: u } = await admin.from("business_units").insert({ code: `zz-recv-${RUN}-rs`, name: `RS ${RUN}` }).select("id").single();
      unitIds.push(u!.id);
      await order(u!.id, { total: 5000, operationType: "retail_sale" });
      await order(u!.id, { total: 300 });
      expect((await receivable(u!.id)).pending_total).toBe(300);
    });

    it("INCLUYE archivados y los desglosa; desglosa también los sin confirmar", async () => {
      const { data: u } = await admin.from("business_units").insert({ code: `zz-recv-${RUN}-arc`, name: `ARC ${RUN}` }).select("id").single();
      unitIds.push(u!.id);
      await order(u!.id, { total: 1000, archived: true });
      await order(u!.id, { total: 200, status: "pending" });
      await order(u!.id, { total: 30, status: "confirmed", archived: true, paid: [10] });
      const r = await receivable(u!.id);
      expect(r.pending_total).toBe(1000 + 200 + 20);
      expect(r.archived_pending_total).toBe(1020);
      expect(r.archived_orders_count).toBe(2);
      expect(r.unconfirmed_pending_total).toBe(200);
      expect(r.unconfirmed_orders_count).toBe(1);
    });

    it("una unidad sin deuda devuelve 0 (no null ni error)", async () => {
      const { data: u } = await admin.from("business_units").insert({ code: `zz-recv-${RUN}-zero`, name: `ZERO ${RUN}` }).select("id").single();
      unitIds.push(u!.id);
      expect(await receivable(u!.id)).toMatchObject({ pending_total: 0, orders_count: 0 });
    });
  });

  describe("filtro por unidad", () => {
    it("cada unidad ve SU deuda; sin filtro incluye ambas", async () => {
      const a = await receivable(unitA);
      const b = await receivable(unitB);
      expect(a.pending_total).toBe(1600);
      expect(b.pending_total).toBe(300);
      // La base trae miles de pedidos de otras suites: sólo puede ser >= la suma.
      expect((await receivable(null)).pending_total).toBeGreaterThanOrEqual(a.pending_total + b.pending_total);
    });

    it("Lista, Kanban y KPI usan el MISMO filtro: la deuda visible coincide con el KPI", async () => {
      currentClient = clients.owner;
      const list = await getOrdersPage({ operationType: "order", includeArchived: true, businessUnitId: unitA });
      expect(list.orders.length).toBe(3);
      expect(list.orders.every((o) => o.business_units?.name.startsWith("Unidad A"))).toBe(true);

      const visibleDebt = list.orders
        .filter((o) => o.status !== "cancelled")
        .reduce((sum, o) => sum + Math.max(o.total - (list.paidByOrder[o.id] ?? 0), 0), 0);
      const kpi = await getOrdersReceivable(unitA);
      expect(kpi?.pendingTotal).toBe(visibleDebt);

      const kanban = await getOrdersKanbanBoard({ includeArchived: true, businessUnitId: unitA });
      expect(Object.values(kanban.counts).reduce((a, b) => a + b, 0)).toBe(3);
      const kanbanB = await getOrdersKanbanBoard({ includeArchived: true, businessUnitId: unitB });
      expect(Object.values(kanbanB.counts).reduce((a, b) => a + b, 0)).toBe(1);
    });

    it("una unidad no ve pedidos de la otra en la Lista", async () => {
      currentClient = clients.owner;
      const list = await getOrdersPage({ operationType: "order", includeArchived: true, businessUnitId: unitB });
      expect(list.orders.map((o) => o.total)).toEqual([900]);
    });
  });

  describe("permisos", () => {
    it("owner, operations y viewer ven el mismo valor; anon no puede llamarlo", async () => {
      const values = await Promise.all((["owner", "operations", "viewer"] as Role[]).map((r) => receivable(unitA, r)));
      expect(new Set(values.map((v) => v.pending_total))).toEqual(new Set([1600]));
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      expect((await anon.rpc("get_orders_receivable", { p_business_unit_id: unitA })).error).not.toBeNull();
    });
  });

  describe("volumen", () => {
    it("la agregación sobre TODA la base local responde rápido (una sola consulta, sin bajar filas)", async () => {
      const started = Date.now();
      await receivable(null);
      expect(Date.now() - started).toBeLessThan(3000);
    });
  });
});
