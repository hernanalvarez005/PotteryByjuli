import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupFixtures } from "../tests/support/fixture-cleanup";
import { correctPaymentRow, loadPaymentHistory } from "./payment-corrections";
import { buildOrderPaymentInsert } from "./payment-insert";
import { paymentSchema } from "../schemas/orders";

// Corrección de pagos (correct_payment / payment_corrections.reason / cierre del
// DELETE directo sobre payments) contra Supabase LOCAL real, con la sesión de cada rol.
// Incluye el caso real que motivó el PR: MAY-000039 (pago de $522.000 probablemente
// mal cargado) y MAY-000040 (pagado $100.200 sobre un total de $52.200).

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
// 2026-09-04 15:30 en Argentina: una hora real de cobro, distinta del mediodía del formulario.
const REAL_PAID_AT = "2026-09-04T18:30:00+00:00";

describe("corrección de pagos (local)", { timeout: 60000 }, () => {
  let admin: SupabaseClient;
  const clients = {} as Record<Role, SupabaseClient>;
  const ids = {} as Record<Role, string>;
  let anon: SupabaseClient;
  let retailUnitId: string;
  let customerId: string;
  let methodA: string;
  let methodB: string;
  const orderIds: string[] = [];
  const customerIds: string[] = [];
  const dueCleanup: { programId?: string; groupId?: string; enrollmentId?: string } = {};

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

  /** Pedido con un total conocido (un ítem personalizado) y, opcionalmente, un pago. */
  async function makeOrder(total: number, payment?: { amount: number; paid_at?: string; method?: string }) {
    const { data: order, error } = await admin
      .from("orders")
      .insert({ business_unit_id: retailUnitId, customer_id: customerId, status: "pending" })
      .select("id")
      .single();
    if (error) throw error;
    orderIds.push(order.id);
    const { error: itemErr } = await admin
      .from("order_items")
      .insert({ order_id: order.id, custom_name: `Pieza ${RUN}`, quantity: 1, unit_price: total });
    if (itemErr) throw itemErr;
    let paymentId: string | null = null;
    if (payment) {
      const { data: p, error: pErr } = await admin
        .from("payments")
        .insert({
          order_id: order.id,
          amount: payment.amount,
          paid_at: payment.paid_at ?? REAL_PAID_AT,
          method_id: payment.method ?? methodA,
          reference: "ref original",
        })
        .select("id")
        .single();
      if (pErr) throw pErr;
      paymentId = p.id;
    }
    return { orderId: order.id as string, paymentId: paymentId as string };
  }

  const correct = (role: Role, paymentId: string, changes: Record<string, unknown>, reason: string | null = null) =>
    clients[role].rpc("correct_payment", { p_payment_id: paymentId, p_changes: changes, p_reason: reason });
  const paymentRow = async (id: string) => (await admin.from("payments").select("*").eq("id", id).single()).data!;
  const corrections = async (paymentId: string) =>
    (await admin.from("payment_corrections").select("*").eq("payment_id", paymentId).order("changed_at", { ascending: true })).data ?? [];
  const balance = async (orderId: string) =>
    (await admin.from("order_balances").select("total,paid_total,balance").eq("order_id", orderId).single()).data!;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    anon = createClient(SUPABASE_URL, ANON_KEY);
    for (const role of ["owner", "operations", "viewer"] as Role[]) await signIn(role);
    retailUnitId = (await admin.from("business_units").select("id").eq("code", "retail").single()).data!.id;
    const { data: methods } = await admin.from("payment_methods").select("id").order("name").limit(2);
    methodA = methods![0].id;
    methodB = methods![1].id;
    customerId = (await admin.from("customers").insert({ first_name: `ZZPagos ${RUN}` }).select("id").single()).data!.id;
  });

  afterAll(async () => {
    await cleanupFixtures(admin, "payment-correction", { orderIds, customerIds: [customerId, ...customerIds] }, async (step) => {
      if (dueCleanup.enrollmentId) await step("workshop_enrollments", () => admin.from("workshop_enrollments").delete().eq("id", dueCleanup.enrollmentId!));
      if (dueCleanup.groupId) await step("workshop_groups", () => admin.from("workshop_groups").delete().eq("id", dueCleanup.groupId!));
      if (dueCleanup.programId) await step("workshop_programs", () => admin.from("workshop_programs").delete().eq("id", dueCleanup.programId!));
    });
  });

  describe("correct_payment", () => {
    it("corregir sólo el importe: actualiza la MISMA fila, conserva paid_at exacto y deja una corrección con quién, cuándo y motivo", async () => {
      const { paymentId } = await makeOrder(52200, { amount: 522000 });
      const before = await paymentRow(paymentId);

      const { error } = await correct("operations", paymentId, { amount: 52200 }, "importe mal cargado");
      expect(error).toBeNull();

      const after = await paymentRow(paymentId);
      expect(after.id).toBe(paymentId);
      expect(Number(after.amount)).toBe(52200);
      expect(new Date(after.paid_at).getTime()).toBe(new Date(before.paid_at).getTime());
      expect(after.created_at).toBe(before.created_at);
      expect(after.method_id).toBe(before.method_id);

      const log = await corrections(paymentId);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ payment_id: paymentId, changed_by: ids.operations, reason: "importe mal cargado" });
      expect(Number(log[0].previous_values.amount)).toBe(522000);
      expect(Number(log[0].new_values.amount)).toBe(52200);
      expect(new Date(log[0].new_values.paid_at).getTime()).toBe(new Date(before.paid_at).getTime());
    });

    it("el motivo es opcional (queda null) y se normaliza (espacios → null)", async () => {
      const { paymentId } = await makeOrder(1000, { amount: 900 });
      expect((await correct("owner", paymentId, { amount: 1000 })).error).toBeNull();
      expect((await correct("owner", paymentId, { amount: 1100 }, "   ")).error).toBeNull();
      expect((await corrections(paymentId)).map((c) => c.reason)).toEqual([null, null]);
    });

    it("clave AUSENTE = sin cambio; clave presente con null vacía el campo", async () => {
      const { paymentId } = await makeOrder(1000, { amount: 500 });
      expect((await correct("operations", paymentId, { reference: "nueva ref" })).error).toBeNull();
      let row = await paymentRow(paymentId);
      expect(row.reference).toBe("nueva ref");
      expect(row.method_id).toBe(methodA);
      expect(Number(row.amount)).toBe(500);

      expect((await correct("operations", paymentId, { method_id: null, reference: null })).error).toBeNull();
      row = await paymentRow(paymentId);
      expect(row.method_id).toBeNull();
      expect(row.reference).toBeNull();
      expect(Number(row.amount)).toBe(500);
    });

    it("cambiar medio, cuenta, notas, comisión y fecha en una sola corrección: una fila de auditoría con todos los previos y nuevos", async () => {
      const { paymentId } = await makeOrder(1000, { amount: 800 });
      const { data: account } = await admin.from("payment_accounts").select("id").limit(1).single();
      const changes = {
        method_id: methodB,
        account_id: account?.id ?? null,
        notes: "corregido a mano",
        fee_amount: 40,
        paid_at: "2026-09-10T12:00:00-03:00",
      };
      expect((await correct("owner", paymentId, changes, "todo mal")).error).toBeNull();
      const row = await paymentRow(paymentId);
      expect(row).toMatchObject({ method_id: methodB, notes: "corregido a mano" });
      expect(Number(row.fee_amount)).toBe(40);
      expect(Number(row.net_amount)).toBe(760);
      expect(new Date(row.paid_at).toISOString()).toBe("2026-09-10T15:00:00.000Z");
      const log = await corrections(paymentId);
      expect(log).toHaveLength(1);
      expect(log[0].previous_values.method_id).toBe(methodA);
      expect(log[0].new_values.method_id).toBe(methodB);
      expect(log[0].previous_values.notes).toBeNull();
      expect(log[0].new_values.notes).toBe("corregido a mano");
    });

    it("saldo y cobrado se recalculan por derivación (no hay nada almacenado que sincronizar): bajar un pago sube el saldo, subirlo lo baja", async () => {
      const { orderId, paymentId } = await makeOrder(52200, { amount: 52200 });
      expect(await balance(orderId)).toMatchObject({ total: 52200, paid_total: 52200, balance: 0 });

      expect((await correct("operations", paymentId, { amount: 20000 }, "era una seña")).error).toBeNull();
      expect(await balance(orderId)).toMatchObject({ total: 52200, paid_total: 20000, balance: 32200 });

      expect((await correct("operations", paymentId, { amount: 52200 })).error).toBeNull();
      expect(await balance(orderId)).toMatchObject({ paid_total: 52200, balance: 0 });
    });

    it("MAY-000040: pagado $100.200 sobre un total de $52.200 (sobrepago) → al corregir a $52.200 el cobrado del pedido baja a lo real", async () => {
      const { orderId, paymentId } = await makeOrder(52200, { amount: 100200 });
      // El saldo nunca es negativo: el sobrepago se ve en lo cobrado, que es lo que infla KPI y reportes.
      expect(await balance(orderId)).toMatchObject({ total: 52200, paid_total: 100200, balance: 0 });

      expect((await correct("operations", paymentId, { amount: 52200 }, "estaba sobrepagado")).error).toBeNull();
      expect(await balance(orderId)).toMatchObject({ total: 52200, paid_total: 52200, balance: 0 });
      const log = await corrections(paymentId);
      expect(Number(log[0].previous_values.amount)).toBe(100200);
      expect(Number(log[0].new_values.amount)).toBe(52200);
    });

    it("MAY-000039: pago de $522.000 sobre un pedido de $52.200 → se corrige al importe correcto y el cobrado deja de estar inflado", async () => {
      const { orderId, paymentId } = await makeOrder(52200, { amount: 522000 });
      expect((await balance(orderId)).paid_total).toBe(522000);
      expect((await correct("owner", paymentId, { amount: 52200 }, "un cero de más")).error).toBeNull();
      expect(await balance(orderId)).toMatchObject({ paid_total: 52200, balance: 0 });
    });

    it("validaciones: ninguna deja rastro (ni cambio ni auditoría)", async () => {
      const { paymentId } = await makeOrder(1000, { amount: 500 });
      const before = await paymentRow(paymentId);
      const attempts: [Record<string, unknown>, RegExp][] = [
        [{ amount: 0 }, /mayor a 0/],
        [{ amount: -5 }, /mayor a 0/],
        [{ fee_amount: 600 }, /comisión/],
        [{ fee_amount: -1 }, /comisión/],
        [{ amount: 100, fee_amount: 200 }, /comisión/],
        [{ foo: 1 }, /no corregible/],
        [{ order_id: "00000000-0000-0000-0000-000000000000" }, /no corregible/],
        [{}, /No hay cambios/],
        [{ amount: 500 }, /No hay cambios/],
        [{ reference: "x".repeat(201) }, /referencia/],
        [{ notes: "x".repeat(501) }, /nota/],
      ];
      for (const [changes, message] of attempts) {
        const { error } = await correct("operations", paymentId, changes);
        expect(error?.message, JSON.stringify(changes)).toMatch(message);
      }
      expect((await correct("operations", paymentId, { amount: 600 }, "x".repeat(301))).error?.message).toMatch(/300/);
      expect((await correct("operations", "00000000-0000-0000-0000-000000000000", { amount: 1 })).error?.message).toMatch(/no existe/);
      expect(await corrections(paymentId)).toHaveLength(0);
      expect(await paymentRow(paymentId)).toEqual(before);
    });

    it("permisos: viewer no puede (ni por RPC ni por UPDATE directo); anon no tiene EXECUTE", async () => {
      const { paymentId } = await makeOrder(1000, { amount: 500 });
      expect((await correct("viewer", paymentId, { amount: 600 })).error?.message).toMatch(/No tenés permiso/);
      const direct = await clients.viewer.from("payments").update({ amount: 700 }).eq("id", paymentId).select("id");
      expect(direct.data ?? []).toHaveLength(0);

      const anonCall = await anon.rpc("correct_payment", { p_payment_id: paymentId, p_changes: { amount: 600 }, p_reason: null });
      expect(anonCall.error?.message).toMatch(/permission denied for function/);

      expect(Number((await paymentRow(paymentId)).amount)).toBe(500);
      expect(await corrections(paymentId)).toHaveLength(0);
    });

    it("dos correcciones simultáneas se serializan: ambas aplican y la segunda ve el estado de la primera", async () => {
      const { paymentId } = await makeOrder(1000, { amount: 500 });
      const [a, b] = await Promise.all([
        correct("owner", paymentId, { amount: 600 }, "A"),
        correct("operations", paymentId, { amount: 700 }, "B"),
      ]);
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();
      const log = await corrections(paymentId);
      expect(log).toHaveLength(2);
      // Cadena consistente: lo "nuevo" de la primera es lo "previo" de la segunda.
      expect(Number(log[0].previous_values.amount)).toBe(500);
      expect(Number(log[1].previous_values.amount)).toBe(Number(log[0].new_values.amount));
      expect(Number((await paymentRow(paymentId)).amount)).toBe(Number(log[1].new_values.amount));
    });

    it("un UPDATE directo posterior NO hereda el motivo de la corrección anterior (la variable no se filtra)", async () => {
      const { paymentId } = await makeOrder(1000, { amount: 500 });
      expect((await correct("owner", paymentId, { amount: 600 }, "con motivo")).error).toBeNull();
      expect((await clients.owner.from("payments").update({ amount: 650 }).eq("id", paymentId)).error).toBeNull();
      expect((await corrections(paymentId)).map((c) => c.reason)).toEqual(["con motivo", null]);
    });

    it("pagos de cuotas de taller se corrigen con el mismo RPC", async () => {
      const { data: program } = await admin.from("workshop_programs").insert({ name: `Programa pagos ${RUN}` }).select("id").single();
      dueCleanup.programId = program!.id;
      const { data: group } = await admin.from("workshop_groups").insert({ program_id: program!.id, name: `Grupo pagos ${RUN}`, capacity: 5 }).select("id").single();
      dueCleanup.groupId = group!.id;
      const { data: enrollment } = await admin.from("workshop_enrollments").insert({ group_id: group!.id, customer_id: customerId }).select("id").single();
      dueCleanup.enrollmentId = enrollment!.id;
      const { data: due } = await admin.from("workshop_dues").insert({ enrollment_id: enrollment!.id, period: "2026-09", amount: 30000 }).select("id").single();
      const { data: payment } = await admin
        .from("payments")
        .insert({ workshop_due_id: due!.id, amount: 3000, paid_at: REAL_PAID_AT, method_id: methodA })
        .select("id")
        .single();

      expect((await correct("operations", payment!.id, { amount: 30000 }, "faltaba un cero")).error).toBeNull();
      expect(Number((await paymentRow(payment!.id)).amount)).toBe(30000);
      expect((await corrections(payment!.id))[0]).toMatchObject({ reason: "faltaba un cero" });
      // El pago sigue colgando de la cuota: no se movió de padre.
      expect((await paymentRow(payment!.id)).workshop_due_id).toBe(due!.id);
    });
  });

  describe("correctPaymentRow (la capa que usan las Server Actions)", () => {
    const form = (over: Partial<Parameters<typeof correctPaymentRow>[3]> = {}) => ({
      amount: 500,
      paid_at: "2026-09-04",
      method_id: methodA as string | null,
      account_id: null as string | null,
      reference: "ref original" as string | null,
      notes: null as string | null,
      fee_amount: 0,
      ...over,
    });

    it("el formulario con la misma fecha NO toca paid_at: corregir sólo el importe conserva la hora real", async () => {
      const { paymentId } = await makeOrder(1000, { amount: 400 });
      const before = await paymentRow(paymentId);
      const result = await correctPaymentRow(clients.operations, paymentId, null, form({ amount: 500 }), "ajuste");
      expect(result).toEqual({});
      const after = await paymentRow(paymentId);
      expect(new Date(after.paid_at).getTime()).toBe(new Date(before.paid_at).getTime());
      const log = await corrections(paymentId);
      expect(log).toHaveLength(1);
      expect(Object.keys(log[0].new_values)).toContain("paid_at");
      expect(new Date(log[0].new_values.paid_at).getTime()).toBe(new Date(log[0].previous_values.paid_at).getTime());
    });

    it("cambiar el día guarda el mediodía de Argentina; volver a enviar lo mismo da 'No hay cambios'", async () => {
      const { paymentId } = await makeOrder(1000, { amount: 500 });
      expect(await correctPaymentRow(clients.owner, paymentId, null, form({ paid_at: "2026-09-12" }), null)).toEqual({});
      expect(new Date((await paymentRow(paymentId)).paid_at).toISOString()).toBe("2026-09-12T15:00:00.000Z");
      expect(await correctPaymentRow(clients.owner, paymentId, null, form({ paid_at: "2026-09-12" }), null)).toEqual({
        error: "No hay cambios para guardar.",
      });
      expect(await corrections(paymentId)).toHaveLength(1);
    });

    it("está acotado a su padre: un pago de otro pedido (o de una cuota) no se corrige con el order_id equivocado", async () => {
      const a = await makeOrder(1000, { amount: 500 });
      const b = await makeOrder(1000, { amount: 500 });
      const wrong = await correctPaymentRow(clients.owner, a.paymentId, { column: "order_id", id: b.orderId }, form({ amount: 999 }), null);
      expect(wrong).toEqual({ error: "El pago no existe." });
      const wrongDue = await correctPaymentRow(clients.owner, a.paymentId, { column: "workshop_due_id", id: b.orderId }, form({ amount: 999 }), null);
      expect(wrongDue).toEqual({ error: "El pago no existe." });
      expect(Number((await paymentRow(a.paymentId)).amount)).toBe(500);
      const right = await correctPaymentRow(clients.owner, a.paymentId, { column: "order_id", id: a.orderId }, form({ amount: 999 }), null);
      expect(right).toEqual({});
    });

    it("viewer: mensaje de permiso, nada cambia", async () => {
      const { paymentId } = await makeOrder(1000, { amount: 500 });
      const result = await correctPaymentRow(clients.viewer, paymentId, null, form({ amount: 600 }), null);
      expect(result.error).toBeDefined();
      expect(Number((await paymentRow(paymentId)).amount)).toBe(500);
    });
  });

  describe("historial visible", () => {
    it("loadPaymentHistory: más reciente primero, con nombres de medio y de usuario, sólo lo que cambió y el motivo", async () => {
      const { paymentId } = await makeOrder(1000, { amount: 500 });
      expect((await correct("owner", paymentId, { amount: 600 }, "primera")).error).toBeNull();
      expect((await correct("operations", paymentId, { method_id: methodB, reference: "otra" }, "segunda")).error).toBeNull();

      const history = await loadPaymentHistory(clients.operations, paymentId);
      expect(history.map((h) => h.reason)).toEqual(["segunda", "primera"]);
      expect(history[0].changes.map((c) => c.field).sort()).toEqual(["method_id", "reference"]);
      expect(history[1].changes.map((c) => c.field)).toEqual(["amount"]);
      const { data: methods } = await admin.from("payment_methods").select("id,name").in("id", [methodA, methodB]);
      const name = (id: string) => methods!.find((m) => m.id === id)!.name;
      const methodChange = history[0].changes.find((c) => c.field === "method_id")!;
      expect(methodChange).toMatchObject({ from: name(methodA), to: name(methodB) });
      const { data: profile } = await admin.from("profiles").select("full_name,email").eq("id", ids.operations).single();
      expect(history[0].changedByName).toBe(profile?.full_name || profile?.email || null);
    });

    it("un pago nunca corregido tiene historial vacío; payment_corrections no admite escrituras de la API", async () => {
      const { paymentId } = await makeOrder(1000, { amount: 500 });
      expect(await loadPaymentHistory(clients.owner, paymentId)).toEqual([]);

      const ins = await clients.owner.from("payment_corrections").insert({ payment_id: paymentId, previous_values: {}, new_values: {} });
      expect(ins.error).not.toBeNull();
      expect((await correct("owner", paymentId, { amount: 600 })).error).toBeNull();
      const [row] = await corrections(paymentId);
      const upd = await clients.owner.from("payment_corrections").update({ reason: "falsificado" }).eq("id", row.id).select("id");
      expect(upd.data ?? []).toHaveLength(0);
      const del = await clients.owner.from("payment_corrections").delete().eq("id", row.id).select("id");
      expect(del.data ?? []).toHaveLength(0);
      expect(await corrections(paymentId)).toHaveLength(1);
    });
  });

  describe("sin DELETE directo sobre payments", () => {
    it("owner y operations no pueden borrar un pago por la API: falla, el pago y su historial siguen", async () => {
      const { paymentId } = await makeOrder(1000, { amount: 500 });
      expect((await correct("owner", paymentId, { amount: 600 }, "para tener historial")).error).toBeNull();

      for (const role of ["owner", "operations", "viewer"] as Role[]) {
        const res = await clients[role].from("payments").delete().eq("id", paymentId).select("id");
        expect(res.error?.message ?? "no error", role).toMatch(/permission denied/);
        expect(res.data ?? []).toHaveLength(0);
      }
      expect(await paymentRow(paymentId)).toBeDefined();
      expect(await corrections(paymentId)).toHaveLength(1);
    });

    it("INSERT y UPDATE directos de operations siguen funcionando (mismos permisos que antes)", async () => {
      const { orderId } = await makeOrder(1000);
      const ins = await clients.operations
        .from("payments")
        .insert({ order_id: orderId, amount: 100, paid_at: REAL_PAID_AT, method_id: methodA })
        .select("id")
        .single();
      expect(ins.error).toBeNull();
      const upd = await clients.operations.from("payments").update({ amount: 150 }).eq("id", ins.data!.id).select("id");
      expect(upd.error).toBeNull();
      expect(upd.data).toHaveLength(1);
      // viewer no inserta
      const viewerIns = await clients.viewer.from("payments").insert({ order_id: orderId, amount: 1, paid_at: REAL_PAID_AT });
      expect(viewerIns.error).not.toBeNull();
    });

    it("el borrado en cascada legítimo sigue andando: delete_order_safe de un pedido con pago y la cascada del admin", async () => {
      const { orderId, paymentId } = await makeOrder(1000, { amount: 500 });
      expect((await correct("owner", paymentId, { amount: 600 })).error).toBeNull();
      const { error } = await admin.from("orders").delete().eq("id", orderId);
      expect(error).toBeNull();
      expect((await admin.from("payments").select("id").eq("id", paymentId)).data).toHaveLength(0);
      expect(await corrections(paymentId)).toHaveLength(0);
      orderIds.splice(orderIds.indexOf(orderId), 1);

      const second = await makeOrder(1000, { amount: 500 });
      const res = await clients.owner.rpc("delete_order_safe", { p_order_id: second.orderId });
      // Cualquiera sea la regla de negocio de delete_order_safe, no puede fallar por el REVOKE DELETE.
      expect(res.error?.message ?? "").not.toMatch(/permission denied for table payments/);
    });
  });
  describe("alta de pago (addPayment)", () => {
    const form = { amount: "1500", paid_at: "2026-10-18", method_id: "", account_id: "", reference: "", notes: "", fee_amount: "", reason: "" };

    it("el payload real del alta se inserta (owner y operations) — regresión: `reason` rompió 'Registrar pago' en todos los pedidos", async () => {
      for (const role of ["owner", "operations"] as Role[]) {
        const { orderId } = await makeOrder(5000);
        const row = buildOrderPaymentInsert(paymentSchema.parse({ ...form, method_id: methodA }), orderId, ids[role]);
        const { data, error } = await clients[role].from("payments").insert(row).select("id,amount,created_by,method_id").single();
        expect(error, role).toBeNull();
        expect(Number(data!.amount)).toBe(1500);
        expect(data!.created_by).toBe(ids[role]);
        expect((await balance(orderId)).paid_total).toBe(1500);
      }
    });

    it("el payload viejo (`...parsed.data` con `reason`) FALLA contra la base: el test detecta la regresión", async () => {
      const { orderId } = await makeOrder(5000);
      const parsed = paymentSchema.parse(form);
      const { error } = await clients.operations.from("payments").insert({ ...parsed, order_id: orderId, paid_at: "2026-10-18T12:00:00-03:00" });
      expect(error).not.toBeNull();
      expect((await balance(orderId)).paid_total).toBe(0);
    });
  });
});
