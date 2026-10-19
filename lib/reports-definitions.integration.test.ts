import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupFixtures, chunk } from "../tests/support/fixture-cleanup";

// Definiciones oficiales de reportes (migración 20261018110000: report_kpis / report_time_series /
// report_by_business_unit / report_by_channel / report_top_products / report_units_sold_selection)
// contra Supabase LOCAL real, con un dataset de números conocidos. Todo vive en 1997 (sin horario de verano en Argentina, así UTC−3 es exacto): antes de
// cualquier ventana de otras suites (incluido el "todo el histórico" que arranca en 2000 y los
// "desde este mes"), así las igualdades son exactas y esta suite NO altera los totales que otras
// suites miden en paralelo.
//
// Reemplaza a los tests "espejo" de dashboard-* y reports-mix-and-sold-at, que reimplementaban la
// fórmula dentro del propio test en vez de ejercitar el código real.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";
const OWNER_EMAIL = "owner-test@pottery.local";
const RUN = Date.now().toString(36);

// Fechas en hora Argentina (UTC-3).
const ART = (iso: string) => `${iso}-03:00`;
const FROM = "1997-03-01";
const TO = "1997-03-31";

type Scope = { unitIds?: string[] | null; locationId?: string | null; channelId?: string | null };

describe("reportes: definiciones oficiales y agregación en el servidor (local)", { timeout: 120000 }, () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let owner: SupabaseClient;
  let retail: string, wholesale: string, classes: string;
  let L1: string, L2: string;
  let chA: string, chB: string;
  let methodId: string;
  let customerId: string;
  let V1: string, V2: string, P1: string, P2: string;
  const orderIds: string[] = [];
  const productIds: string[] = [];
  const incomeIds: string[] = [];
  const extraUnitIds: string[] = [];
  // Unidades dedicadas con pedidos en masa: se borran de una vez por su business_unit_id (un id exacto
  // creado por esta suite), en vez de 1.250 ids en tandas de 50 (agotaba el timeout del hook).
  const bulkUnitIds: string[] = [];
  const o: Record<string, string> = {};
  const dues: { programId?: string; groupIds: string[]; enrollmentIds: string[]; dueIds: string[]; customerIds: string[] } = {
    groupIds: [], enrollmentIds: [], dueIds: [], customerIds: [],
  };

  const args = (from: string, to: string, s: Scope = {}) => ({
    p_from: from, p_to: to, p_business_unit_ids: s.unitIds ?? null, p_location_id: s.locationId ?? null, p_channel_id: s.channelId ?? null,
  });
  const rpc = async <T = Record<string, unknown>>(name: string, a: Record<string, unknown>): Promise<T[]> => {
    const { data, error } = await owner.rpc(name, a);
    if (error) throw new Error(`${name}: ${error.message}`);
    return (data ?? []) as T[];
  };
  const kpis = async (s: Scope = {}, from = FROM, to = TO) => {
    const [r] = await rpc<Record<string, number | string>>("report_kpis", args(from, to, s));
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? null : Number(v)])) as Record<string, number | null>;
  };

  async function makeOrder(
    key: string,
    spec: {
      unit: string; location: string; channel: string; sale: string; status: string; opType?: string; discount?: number;
      items: { variant?: string; custom?: string; qty: number; price: number }[];
      payments?: { amount: number; at: string }[];
    }
  ) {
    const { data: order, error } = await admin.from("orders").insert({
      business_unit_id: spec.unit, customer_id: customerId, location_id: spec.location, closing_channel_id: spec.channel,
      sale_date: spec.sale, status: spec.status, operation_type: spec.opType ?? "order", discount_total: spec.discount ?? 0,
    }).select("id").single();
    if (error) throw error;
    orderIds.push(order.id);
    o[key] = order.id;
    const { error: itemErr } = await admin.from("order_items").insert(
      spec.items.map((i) => ({
        order_id: order.id, product_variant_id: i.variant ?? null, custom_name: i.variant ? null : (i.custom ?? "a medida"), quantity: i.qty, unit_price: i.price,
      }))
    );
    if (itemErr) throw itemErr;
    if (spec.payments?.length) {
      const { error: payErr } = await admin.from("payments").insert(
        spec.payments.map((p) => ({ order_id: order.id, amount: p.amount, paid_at: p.at, method_id: methodId }))
      );
      if (payErr) throw payErr;
    }
  }

  async function makeProduct(name: string, price = 1000) {
    const { data: product } = await admin.from("products").insert({ name: `${RUN} ${name}`, is_active: true }).select("id").single();
    productIds.push(product!.id);
    const variantId = (await admin.from("product_variants").select("id").eq("product_id", product!.id).single()).data!.id as string;
    return { productId: product!.id as string, variantId, price };
  }

  async function makeWorkshopPayment(locationId: string, amount: number, at: string, period: string) {
    if (!dues.programId) dues.programId = (await admin.from("workshop_programs").insert({ name: `${RUN} programa reportes` }).select("id").single()).data!.id;
    const group = (await admin.from("workshop_groups").insert({ program_id: dues.programId, name: `${RUN} grupo ${dues.groupIds.length}`, capacity: 5, location_id: locationId }).select("id").single()).data!;
    dues.groupIds.push(group.id);
    const alumna = (await admin.from("customers").insert({ first_name: `${RUN} Alumna ${dues.customerIds.length}` }).select("id").single()).data!;
    dues.customerIds.push(alumna.id);
    const enrollment = (await admin.from("workshop_enrollments").insert({ group_id: group.id, customer_id: alumna.id }).select("id").single()).data!;
    dues.enrollmentIds.push(enrollment.id);
    const due = (await admin.from("workshop_dues").insert({ enrollment_id: enrollment.id, period, amount: 100000 }).select("id").single()).data!;
    dues.dueIds.push(due.id);
    const { error } = await admin.from("payments").insert({ workshop_due_id: due.id, amount, paid_at: at, method_id: methodId });
    if (error) throw error;
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    anon = createClient(SUPABASE_URL, ANON_KEY);
    owner = createClient(SUPABASE_URL, ANON_KEY);
    const { error: signErr } = await owner.auth.signInWithPassword({ email: OWNER_EMAIL, password: PASSWORD });
    if (signErr) throw signErr;
    const unit = async (code: string) => (await admin.from("business_units").select("id").eq("code", code).single()).data!.id as string;
    [retail, wholesale, classes] = [await unit("retail"), await unit("wholesale"), await unit("classes")];
    const locs = (await admin.from("locations").select("id").order("code").limit(2)).data!;
    [L1, L2] = [locs[0].id, locs[1].id];
    const chans = (await admin.from("sales_channels").select("id").order("code").limit(2)).data!;
    [chA, chB] = [chans[0].id, chans[1].id];
    methodId = (await admin.from("payment_methods").select("id").limit(1).single()).data!.id;
    customerId = (await admin.from("customers").insert({ first_name: `${RUN} Cliente reportes` }).select("id").single()).data!.id;
    const p1 = await makeProduct("Taza Amalia", 500);
    const p2 = await makeProduct("Plato Bahía", 1000);
    [V1, P1, V2, P2] = [p1.variantId, p1.productId, p2.variantId, p2.productId];

    // ─── Dataset (marzo 1997, hora Argentina) ───────────────────────────────────────────────
    // O1 retail/L1/A, 05-mar, entregado: ítem a medida $1000. Pagos: 600 (06-mar), 50 (01-mar 00:00:00),
    //    40 (28-feb 23:59:59 → FUERA del período). Pagado 690 → saldo 310.
    await makeOrder("O1", { unit: retail, location: L1, channel: chA, sale: "1997-03-05", status: "delivered", items: [{ custom: "Pieza a medida", qty: 1, price: 1000 }],
      payments: [{ amount: 600, at: ART("1997-03-06T10:00:00") }, { amount: 50, at: ART("1997-03-01T00:00:00") }, { amount: 40, at: ART("1997-02-28T23:59:59") }] });
    // O2 retail/L1/B, 10-mar, confirmado: 3 × V1 @500 = 1500 − descuento 200 = 1300. Pago 1300 (11-mar). Saldado.
    await makeOrder("O2", { unit: retail, location: L1, channel: chB, sale: "1997-03-10", status: "confirmed", discount: 200, items: [{ variant: V1, qty: 3, price: 500 }],
      payments: [{ amount: 1300, at: ART("1997-03-11T12:00:00") }] });
    // O3 wholesale/L2/A, 31-mar, pendiente: 2 × V1 @400 + 1 × V2 @1000 = 1800. Pago 2000 el 01-abr 00:30 (FUERA del
    //    período, pero sobrepagado en 200 "a la fecha").
    await makeOrder("O3", { unit: wholesale, location: L2, channel: chA, sale: "1997-03-31", status: "pending", items: [{ variant: V1, qty: 2, price: 400 }, { variant: V2, qty: 1, price: 1000 }],
      payments: [{ amount: 2000, at: ART("1997-04-01T00:30:00") }] });
    // O4 retail/L1/A, 15-mar, CANCELADO: $700. Pago 700 (16-mar): no entra en cobrado, sí en collected_on_cancelled.
    await makeOrder("O4", { unit: retail, location: L1, channel: chA, sale: "1997-03-15", status: "cancelled", items: [{ custom: "Cancelado", qty: 1, price: 700 }],
      payments: [{ amount: 700, at: ART("1997-03-16T09:00:00") }] });
    // O5 venta rápida retail/L2/A, 20-mar, entregada: 2 × V2 @1000 = 2000. Pago 2000 el 20-mar 23:59:59 (último segundo).
    await makeOrder("O5", { unit: retail, location: L2, channel: chA, sale: "1997-03-20", status: "delivered", opType: "retail_sale", items: [{ variant: V2, qty: 2, price: 1000 }],
      payments: [{ amount: 2000, at: ART("1997-03-20T23:59:59") }] });
    // O6 retail/L1/A, vendido el 02-abr (FUERA del período) pero cobrado 500 el 12-mar: suma a "cobrado", no a facturación.
    await makeOrder("O6", { unit: retail, location: L1, channel: chA, sale: "1997-04-02", status: "delivered", items: [{ custom: "Abril", qty: 1, price: 500 }],
      payments: [{ amount: 500, at: ART("1997-03-12T15:00:00") }] });
    // Talleres (cuotas cobradas): 300 en L1 el 08-mar, 200 en L2 el 09-mar.
    await makeWorkshopPayment(L1, 300, ART("1997-03-08T11:00:00"), "1997-03");
    await makeWorkshopPayment(L2, 200, ART("1997-03-09T11:00:00"), "1997-03");
    // Otros ingresos: 150 en L1 (12-mar), 80 en L2 (13-mar).
    for (const [loc, amount, at] of [[L1, 150, "1997-03-12T10:00:00"], [L2, 80, "1997-03-13T10:00:00"]] as const) {
      const { data } = await admin.from("income_entries").insert({ concept: `${RUN} ingreso`, amount, occurred_at: ART(at), location_id: loc }).select("id").single();
      incomeIds.push(data!.id);
    }
  }, 60000);

  afterAll(async () => {
    for (const unitId of bulkUnitIds) await admin.from("orders").delete().eq("business_unit_id", unitId);
    for (const ids of chunk(incomeIds)) await admin.from("income_entries").delete().in("id", ids);
    await cleanupFixtures(admin, "reports-definitions", { orderIds, productIds, customerIds: [customerId, ...dues.customerIds] }, async (step) => {
      for (const ids of chunk(dues.enrollmentIds)) await step("workshop_enrollments", () => admin.from("workshop_enrollments").delete().in("id", ids));
      for (const ids of chunk(dues.groupIds)) await step("workshop_groups", () => admin.from("workshop_groups").delete().in("id", ids));
      if (dues.programId) await step("workshop_programs", () => admin.from("workshop_programs").delete().eq("id", dues.programId!));
    });
    for (const id of extraUnitIds) await admin.from("business_units").delete().eq("id", id);
  }, 60000);

  describe("KPIs sin filtros (marzo 1997)", () => {
    it("facturación: sólo pedidos NO cancelados, por sale_date (cancelado y fuera de rango excluidos); descuento incluido", async () => {
      const k = await kpis();
      // O1 1000 + O2 1300 (1500−200) + O3 1800 + O5 2000; O4 (cancelado) y O6 (abril) no.
      expect(k.invoiced).toBe(6100);
      expect(k.orders_count).toBe(4);
      expect(k.avg_ticket).toBe(1525);
    });

    it("cobrado = caja del período por paid_at (hora Argentina): pedidos + talleres + otros; excluye cancelados y bordes", async () => {
      const k = await kpis();
      // Pedidos: O1 600+50 (el de 28-feb 23:59:59 queda afuera), O2 1300, O5 2000 (20-mar 23:59:59 adentro),
      // O6 500 (cobrado en marzo aunque vendido en abril). O3 se cobró el 01-abr: afuera. O4 cancelado: afuera.
      expect(k.collected_orders).toBe(650 + 1300 + 2000 + 500);
      expect(k.collected_workshops).toBe(500);
      expect(k.collected_other).toBe(230);
      expect(k.collected_total).toBe(4450 + 500 + 230);
      expect(k.collected_on_cancelled).toBe(700);
    });

    it("pendiente = saldo vigente de la cohorte facturada; identidad facturación = cobrado − sobrepago + pendiente", async () => {
      const k = await kpis();
      expect(k.cohort_paid).toBe(690 + 1300 + 2000 + 2000);
      expect(k.cohort_pending).toBe(310); // sólo O1 debe
      expect(k.cohort_overpaid).toBe(200); // O3 pagó 2000 sobre 1800
      expect(k.invoiced).toBe(k.cohort_paid! - k.cohort_overpaid! + k.cohort_pending!);
    });

    it("el cobro de talleres NUNCA tapa el pendiente (regresión del bug de 'Todas')", async () => {
      const all = await kpis();
      const retailOnly = await kpis({ unitIds: [retail] });
      expect(all.cohort_pending).toBe(310);
      expect(retailOnly.cohort_pending).toBe(310);
      expect(all.collected_workshops).toBe(500);
    });
  });

  describe("filtros", () => {
    it("unidad: una sola, varias, y 'todas' (null) == todas explícitas", async () => {
      expect((await kpis({ unitIds: [retail] })).invoiced).toBe(1000 + 1300 + 2000);
      expect((await kpis({ unitIds: [wholesale] })).invoiced).toBe(1800);
      expect((await kpis({ unitIds: [retail, wholesale] })).invoiced).toBe(6100);
      const everyUnit = (await admin.from("business_units").select("id")).data!.map((u) => u.id as string);
      expect((await kpis({ unitIds: everyUnit })).invoiced).toBe((await kpis()).invoiced);
      // Nunca "menos" que la suma de sus partes.
      expect((await kpis({ unitIds: [retail] })).invoiced! + (await kpis({ unitIds: [wholesale] })).invoiced!).toBe(6100);
    });

    it("canal de cierre: filtra pedidos y EXCLUYE talleres y otros ingresos (no tienen canal)", async () => {
      const a = await kpis({ channelId: chA });
      expect(a.invoiced).toBe(1000 + 1800 + 2000);
      expect(a.collected_orders).toBe(650 + 2000 + 500);
      expect(a.collected_workshops).toBe(0);
      expect(a.collected_other).toBe(0);
      expect((await kpis({ channelId: chB })).invoiced).toBe(1300);
    });

    it("unidad: talleres sólo con 'todas' o incluyendo classes; otros ingresos sólo con 'todas'", async () => {
      const onlyRetail = await kpis({ unitIds: [retail] });
      expect(onlyRetail.collected_workshops).toBe(0);
      expect(onlyRetail.collected_other).toBe(0);
      const onlyClasses = await kpis({ unitIds: [classes] });
      expect(onlyClasses.invoiced).toBe(0);
      expect(onlyClasses.collected_workshops).toBe(500);
      expect(onlyClasses.collected_other).toBe(0);
      const mixed = await kpis({ unitIds: [retail, classes] });
      expect(mixed.collected_workshops).toBe(500);
      expect(mixed.collected_other).toBe(0);
    });

    it("ubicación: pedidos por orders.location_id, cuotas por la ubicación del GRUPO, otros ingresos por la suya", async () => {
      const l1 = await kpis({ locationId: L1 });
      expect(l1.invoiced).toBe(1000 + 1300);
      expect(l1.collected_orders).toBe(650 + 1300 + 500);
      expect(l1.collected_workshops).toBe(300);
      expect(l1.collected_other).toBe(150);
      const l2 = await kpis({ locationId: L2 });
      expect(l2.invoiced).toBe(1800 + 2000);
      expect(l2.collected_workshops).toBe(200);
      expect(l2.collected_other).toBe(80);
    });

    it("el rango de paid_at se respeta junto con la ubicación (cuotas)", async () => {
      expect((await kpis({ locationId: L1 }, "1997-03-09", "1997-03-31")).collected_workshops).toBe(0);
      expect((await kpis({ locationId: L1 }, "1997-03-08", "1997-03-08")).collected_workshops).toBe(300);
    });

    it("el cobrado cuenta por paid_at, no por created_at (se cargó hoy, se cobró en 1997)", async () => {
      const inRange = await kpis({}, "1997-03-06", "1997-03-06");
      expect(inRange.collected_orders).toBe(600);
      const loadedToday = await kpis({}, new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
      expect(loadedToday.collected_orders).not.toBe(600);
    });

    it("bordes de día en hora Argentina: 00:00:00 del 'from' y 23:59:59 del 'to' entran; 28-feb 23:59:59 y 01-abr 00:30 no", async () => {
      expect((await kpis({}, "1997-03-01", "1997-03-01")).collected_orders).toBe(50);
      expect((await kpis({}, "1997-02-28", "1997-02-28")).collected_orders).toBe(40);
      expect((await kpis({}, "1997-03-20", "1997-03-20")).collected_orders).toBe(2000);
      expect((await kpis({}, "1997-04-01", "1997-04-01")).collected_orders).toBe(2000);
    });
  });

  describe("serie en el tiempo, por unidad y por canal", () => {
    it("diaria (≤62 días): una fila por día, sin huecos, y las sumas igualan a los KPIs", async () => {
      const series = await rpc<{ bucket: string; invoiced: string; orders_count: string; collected: string }>("report_time_series", args(FROM, TO));
      expect(series).toHaveLength(31);
      expect(series[0].bucket).toBe("1997-03-01");
      expect(series[30].bucket).toBe("1997-03-31");
      const k = await kpis();
      expect(series.reduce((s, r) => s + Number(r.invoiced), 0)).toBe(k.invoiced);
      expect(series.reduce((s, r) => s + Number(r.collected), 0)).toBe(k.collected_total);
      expect(series.reduce((s, r) => s + Number(r.orders_count), 0)).toBe(k.orders_count);
      const day = (d: string) => series.find((r) => r.bucket === d)!;
      expect(Number(day("1997-03-31").invoiced)).toBe(1800); // sale_date, no la fecha de pago
      expect(Number(day("1997-03-20").collected)).toBe(2000); // 23:59:59 cae en el 20, no en el 21
      expect(Number(day("1997-03-21").collected)).toBe(0);
      expect(Number(day("1997-03-01").collected)).toBe(50); // 00:00:00 cae en el 1
    });

    it("cuenta TODOS los pedidos no cancelados (no sólo los entregados): confirmado y pendiente aparecen", async () => {
      const series = await rpc<{ bucket: string; invoiced: string }>("report_time_series", args(FROM, TO));
      expect(Number(series.find((r) => r.bucket === "1997-03-10")!.invoiced)).toBe(1300); // confirmado
      expect(Number(series.find((r) => r.bucket === "1997-03-31")!.invoiced)).toBe(1800); // pendiente
      expect(Number(series.find((r) => r.bucket === "1997-03-15")!.invoiced)).toBe(0); // cancelado
    });

    it("mensual (>62 días): un bucket por mes, ordenado, y las sumas igualan a los KPIs del mismo rango", async () => {
      const series = await rpc<{ bucket: string; invoiced: string; collected: string }>("report_time_series", args("1997-01-01", "1997-06-30"));
      expect(series.map((r) => r.bucket)).toEqual(["1997-01", "1997-02", "1997-03", "1997-04", "1997-05", "1997-06"]);
      const k = await kpis({}, "1997-01-01", "1997-06-30");
      expect(series.reduce((s, r) => s + Number(r.invoiced), 0)).toBe(k.invoiced);
      expect(series.reduce((s, r) => s + Number(r.collected), 0)).toBe(k.collected_total);
      expect(Number(series[3].invoiced)).toBe(500); // O6, vendido en abril
    });

    it("por unidad: sólo pedidos (Talleres NO se mezcla) y la suma es la facturación", async () => {
      const rows = await rpc<{ name: string; invoiced: string; orders_count: string }>("report_by_business_unit", args(FROM, TO));
      expect(rows.map((r) => [r.name, Number(r.invoiced), Number(r.orders_count)])).toEqual([["Minorista", 4300, 3], ["Mayorista", 1800, 1]]);
      expect(rows.some((r) => /taller/i.test(r.name))).toBe(false);
      expect(rows.reduce((s, r) => s + Number(r.invoiced), 0)).toBe((await kpis()).invoiced);
    });

    it("por canal: suma la facturación; un canal filtrado deja sólo ese", async () => {
      const rows = await rpc<{ channel_id: string; invoiced: string }>("report_by_channel", args(FROM, TO));
      expect(Object.fromEntries(rows.map((r) => [r.channel_id, Number(r.invoiced)]))).toEqual({ [chA]: 4800, [chB]: 1300 });
      const onlyB = await rpc<{ channel_id: string; invoiced: string }>("report_by_channel", args(FROM, TO, { channelId: chB }));
      expect(onlyB).toHaveLength(1);
      expect(Number(onlyB[0].invoiced)).toBe(1300);
    });
  });

  describe("productos y selección libre de modelos", () => {
    const top = (limit = 10, s: Scope = {}) =>
      rpc<{ variant_id: string | null; label: string; units: string; revenue: string; is_custom: boolean }>("report_top_products", { ...args(FROM, TO, s), p_limit: limit });

    it("unidades y facturación por variante; los ítems a medida van agrupados (no se pierden)", async () => {
      const rows = await top();
      const byLabel = Object.fromEntries(rows.map((r) => [r.label, [Number(r.units), Number(r.revenue)]]));
      expect(byLabel[`${RUN} Taza Amalia`]).toEqual([5, 3 * 500 + 2 * 400]); // O2 (3) + O3 (2)
      expect(byLabel[`${RUN} Plato Bahía`]).toEqual([3, 1000 + 2000]); // O3 (1) + O5 (2)
      expect(byLabel["Ítems a medida"]).toEqual([1, 1000]); // O1; el cancelado y el de abril no
      expect(rows.find((r) => r.is_custom)!.variant_id).toBeNull();
    });

    it("la suma por producto + a medida es la facturación ANTES del descuento global (1500 de O2 vs 1300 facturado)", async () => {
      const rows = await top(100);
      const revenue = rows.filter((r) => r.label.startsWith(RUN) || r.is_custom).reduce((s, r) => s + Number(r.revenue), 0);
      expect(revenue).toBe(6100 + 200); // 6100 facturado + 200 de descuento de O2
    });

    it("el límite se respeta y ordena por unidades", async () => {
      const rows = await top(1);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].units)).toBeGreaterThanOrEqual(5);
    });

    it("selección libre: total de unidades de varios modelos elegidos a mano, uno por variante, con 0 para los que no vendieron", async () => {
      const p3 = await makeProduct("Jarrón Sin Ventas");
      const rows = await rpc<{ variant_id: string; label: string; units: string; revenue: string }>("report_units_sold_selection", {
        ...args(FROM, TO), p_product_ids: [P1, P2, p3.productId], p_variant_ids: null,
      });
      expect(rows).toHaveLength(3);
      const byLabel = Object.fromEntries(rows.map((r) => [r.label, Number(r.units)]));
      expect(byLabel).toEqual({ [`${RUN} Taza Amalia`]: 5, [`${RUN} Plato Bahía`]: 3, [`${RUN} Jarrón Sin Ventas`]: 0 });
      expect(rows.reduce((s, r) => s + Number(r.units), 0)).toBe(8); // el total del grupo
      expect(Number(rows.find((r) => r.variant_id === p3.variantId)!.revenue)).toBe(0);
    });

    it("selección por variante suelta y mezclada con productos (sin duplicar)", async () => {
      const rows = await rpc<{ variant_id: string; units: string }>("report_units_sold_selection", { ...args(FROM, TO), p_product_ids: [P1], p_variant_ids: [V1, V2] });
      expect(rows.map((r) => r.variant_id).sort()).toEqual([V1, V2].sort());
      expect(rows.reduce((s, r) => s + Number(r.units), 0)).toBe(8);
    });

    it("la selección respeta los mismos filtros que la facturación (unidad, ubicación, canal y período)", async () => {
      const sel = async (s: Scope, from = FROM, to = TO) =>
        (await rpc<{ units: string }>("report_units_sold_selection", { ...args(from, to, s), p_product_ids: [P1, P2] })).reduce((n, r) => n + Number(r.units), 0);
      expect(await sel({ unitIds: [wholesale] })).toBe(3); // O3: 2 tazas + 1 plato
      expect(await sel({ unitIds: [retail] })).toBe(5); // O2: 3 tazas + O5: 2 platos
      expect(await sel({ locationId: L2 })).toBe(5); // O3 (3) + O5 (2)
      expect(await sel({ channelId: chB })).toBe(3); // O2
      expect(await sel({}, "1997-03-11", "1997-03-30")).toBe(2); // sólo O5 (20-mar)
    });

    it("una selección vacía devuelve vacío (nunca 'todos')", async () => {
      expect(await rpc("report_units_sold_selection", { ...args(FROM, TO), p_product_ids: null, p_variant_ids: null })).toEqual([]);
      expect(await rpc("report_units_sold_selection", { ...args(FROM, TO), p_product_ids: [], p_variant_ids: [] })).toEqual([]);
    });
  });

  describe("reconciliación con order_balances y get_orders_receivable", () => {
    it("sin filtros de período, el pendiente total == get_orders_receivable (unidad aislada para no depender de otras suites)", async () => {
      const { data: unit } = await admin.from("business_units").insert({ code: `zz${RUN}`, name: `ZZ ${RUN}` }).select("id").single();
      extraUnitIds.push(unit!.id);
      // 3 pedidos 'order' con saldo (pendiente, confirmado, archivado), 1 pagado, 1 cancelado con saldo y 1 venta rápida.
      const mk = async (key: string, over: Record<string, unknown>, total: number, paid: number) => {
        const { data: ord } = await admin.from("orders").insert({ business_unit_id: unit!.id, customer_id: customerId, sale_date: "1997-03-12", location_id: L1, ...over }).select("id").single();
        orderIds.push(ord!.id);
        o[key] = ord!.id;
        await admin.from("order_items").insert({ order_id: ord!.id, custom_name: "x", quantity: 1, unit_price: total });
        if (paid) await admin.from("payments").insert({ order_id: ord!.id, amount: paid, paid_at: ART("1997-03-12T10:00:00"), method_id: methodId });
      };
      await mk("Z1", { status: "pending" }, 1000, 250);
      await mk("Z2", { status: "confirmed" }, 2000, 0);
      await mk("Z3", { status: "confirmed", archived_at: new Date().toISOString() }, 500, 100);
      await mk("Z4", { status: "delivered" }, 800, 800);
      await mk("Z5", { status: "cancelled" }, 900, 0);
      await mk("Z6", { status: "delivered", operation_type: "retail_sale" }, 300, 300);

      const [receivable] = (await owner.rpc("get_orders_receivable", { p_business_unit_id: unit!.id })).data as { pending_total: string; orders_count: string }[];
      const k = await kpis({ unitIds: [unit!.id] });
      expect(Number(receivable.pending_total)).toBe(750 + 2000 + 400);
      expect(k.pending_total_all).toBe(Number(receivable.pending_total));
      expect(k.pending_orders_all).toBe(Number(receivable.orders_count));
      // La cohorte del mismo período reconcilia con order_balances (excluye cancelados y ventas rápidas con saldo 0).
      const { data: balances } = await admin.from("order_balances").select("order_id,balance").in("order_id", [o.Z1, o.Z2, o.Z3, o.Z4, o.Z6]);
      expect(k.cohort_pending).toBe(balances!.reduce((s, b) => s + Number(b.balance), 0));
      expect(k.invoiced).toBe(1000 + 2000 + 500 + 800 + 300);
    });
  });

  describe("más de 1.000 filas: los totales nunca se topean", () => {
    it("1.250 pedidos con pago e ítem en el período: facturación, cobrado, serie y top productos suman exacto (el código viejo daba 1.000)", async () => {
      const { data: unit } = await admin.from("business_units").insert({ code: `zy${RUN}`, name: `ZY ${RUN}` }).select("id").single();
      extraUnitIds.push(unit!.id);
      const N = 1250;
      const bulkIds: string[] = [];
      for (const part of chunk(Array.from({ length: N }, (_, i) => i), 250)) {
        const { data, error } = await admin.from("orders").insert(
          part.map(() => ({ business_unit_id: unit!.id, customer_id: customerId, sale_date: "1997-05-10", location_id: L1, status: "delivered" }))
        ).select("id");
        if (error) throw error;
        bulkIds.push(...data!.map((r) => r.id as string));
      }
      bulkUnitIds.push(unit!.id);
      for (const part of chunk(bulkIds, 250)) {
        const { error } = await admin.from("order_items").insert(part.map((id) => ({ order_id: id, product_variant_id: V1, quantity: 2, unit_price: 50 })));
        if (error) throw error;
        const { error: payErr } = await admin.from("payments").insert(part.map((id) => ({ order_id: id, amount: 100, paid_at: ART("1997-05-10T12:00:00"), method_id: methodId })));
        if (payErr) throw payErr;
      }
      const scope = { unitIds: [unit!.id] };
      const k = await kpis(scope, "1997-05-01", "1997-05-31");
      expect(k.orders_count).toBe(N);
      expect(k.invoiced).toBe(N * 100);
      expect(k.collected_orders).toBe(N * 100);
      expect(k.cohort_pending).toBe(0);
      const series = await rpc<{ invoiced: string; orders_count: string }>("report_time_series", args("1997-05-01", "1997-05-31", scope));
      expect(series.reduce((s, r) => s + Number(r.invoiced), 0)).toBe(N * 100);
      expect(series.reduce((s, r) => s + Number(r.orders_count), 0)).toBe(N);
      const [row] = await rpc<{ units: string }>("report_top_products", { ...args("1997-05-01", "1997-05-31", scope), p_limit: 5 });
      expect(Number(row.units)).toBe(N * 2);
      const [sel] = await rpc<{ units: string }>("report_units_sold_selection", { ...args("1997-05-01", "1997-05-31", scope), p_variant_ids: [V1] });
      expect(Number(sel.units)).toBe(N * 2);
    });
  });

  describe("permisos", () => {
    it("anon no ejecuta ninguna función de reportes", async () => {
      const calls = [
        anon.rpc("report_kpis", args(FROM, TO)),
        anon.rpc("report_time_series", args(FROM, TO)),
        anon.rpc("report_by_business_unit", args(FROM, TO)),
        anon.rpc("report_by_channel", args(FROM, TO)),
        anon.rpc("report_top_products", { ...args(FROM, TO), p_limit: 5 }),
        anon.rpc("report_units_sold_selection", { ...args(FROM, TO), p_product_ids: [P1] }),
        anon.rpc("report_production_counts", {}),
        anon.rpc("report_wholesale_conversion", {}),
        anon.rpc("report_orders_in_scope", args(FROM, TO)),
        anon.rpc("report_collections_in_scope", args(FROM, TO)),
      ];
      for (const result of await Promise.all(calls)) expect(result.error?.message).toMatch(/permission denied for function/);
    });
  });
});
