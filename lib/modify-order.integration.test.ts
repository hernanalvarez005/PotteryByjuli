import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PDFParse } from "pdf-parse";
import { cleanupFixtures } from "../tests/support/fixture-cleanup";
import { renderWholesaleOrderPdf } from "./wholesale-pdf";
import { loadWholesaleDocumentData, storeWholesaleOrderPdf, ORDER_ATTACHMENTS_BUCKET, wholesalePdfStoragePath } from "./wholesale-pdf-store";
import { pdfStaleness } from "./order-modification";

// "Modificar pedido" (modify_order / order_adjustments / cierre de UPDATE-DELETE
// directo de order_items / PDF desactualizado) contra Supabase LOCAL real, con la
// sesión de cada rol. Cada caso crea sus propios productos y stock para aislarse.

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

type Change = Record<string, unknown>;

describe("modify_order (local)", { timeout: 60000 }, () => {
  let admin: SupabaseClient;
  const clients = {} as Record<Role, SupabaseClient>;
  const ids = {} as Record<Role, string>;
  let retailUnitId: string;
  let wholesaleUnitId: string;
  let locationId: string;
  let customerId: string;
  let paymentMethodId: string;
  const orderIds: string[] = [];
  const productIds: string[] = [];
  const customerIds: string[] = [];
  const paths: string[] = [];

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

  /** Producto nuevo (una variante "Único") con `stock` unidades en la ubicación de prueba. */
  async function makeVariant(stock: number, name = `${RUN} Pieza`) {
    const { data: product, error } = await admin.from("products").insert({ name: `${name} ${productIds.length}`, is_active: true }).select("id").single();
    if (error) throw error;
    productIds.push(product.id);
    const variantId = (await admin.from("product_variants").select("id").eq("product_id", product.id).single()).data!.id as string;
    const inventoryItemId = (await admin.from("inventory_items").select("id").eq("product_variant_id", variantId).single()).data!.id as string;
    if (stock > 0) {
      await admin.from("inventory_movements").insert({ inventory_item_id: inventoryItemId, location_id: locationId, movement_type: "production_in", quantity: stock });
    }
    return { variantId, inventoryItemId };
  }

  async function makeOrder(opts: { items: Change[]; status?: "pending" | "confirmed" | "delivered"; unitId?: string; discount?: number }) {
    const { data: id, error } = await clients.operations.rpc("create_order", {
      p_business_unit_id: opts.unitId ?? retailUnitId, p_customer_id: customerId, p_location_id: locationId,
      p_origin_channel_id: null, p_closing_channel_id: null, p_delivery_method: null, p_delivery_address: null,
      p_estimated_date: null, p_notes: null, p_items: opts.items,
    });
    if (error) throw error;
    orderIds.push(id as string);
    if (opts.discount) await admin.from("orders").update({ discount_total: opts.discount }).eq("id", id);
    if (opts.status === "confirmed" || opts.status === "delivered") {
      const r = await clients.operations.rpc("set_order_status", { p_order_id: id, p_new_status: "confirmed" });
      if (r.error) throw r.error;
    }
    if (opts.status === "delivered") {
      const r = await clients.operations.rpc("set_order_status", { p_order_id: id, p_new_status: "delivered" });
      if (r.error) throw r.error;
    }
    return id as string;
  }

  const modify = (orderId: string, changes: Change[], reason: string | null = "prueba", consume = true, role: Role = "operations") =>
    clients[role].rpc("modify_order", { p_order_id: orderId, p_changes: changes, p_reason: reason, p_consume_stock: consume });

  const order = async (id: string) => (await admin.from("orders").select("*").eq("id", id).single()).data!;
  const itemsOf = async (id: string) => (await admin.from("order_items").select("*").eq("order_id", id)).data ?? [];
  const adjustments = async (id: string) => (await admin.from("order_adjustments").select("*").eq("order_id", id).order("created_at")).data ?? [];
  const paymentsOf = async (id: string) => (await admin.from("payments").select("id,amount").eq("order_id", id).order("created_at")).data ?? [];
  const balanceOf = async (id: string) => (await admin.from("order_balances").select("total,paid_total,balance").eq("order_id", id).single()).data!;
  const stockOf = async (inventoryItemId: string) => {
    const { data } = await admin.from("inventory_movements").select("quantity").eq("inventory_item_id", inventoryItemId).eq("location_id", locationId);
    return (data ?? []).reduce((s, m) => s + Number(m.quantity), 0);
  };
  const activeReservedOf = async (id: string) =>
    ((await admin.from("inventory_reservations").select("quantity").eq("order_id", id).eq("status", "active")).data ?? []).reduce((s, r) => s + Number(r.quantity), 0);
  const productionOf = async (id: string) => (await admin.from("production_orders").select("quantity,origin,notes").eq("order_id", id)).data ?? [];
  const pay = async (id: string, amount: number) => {
    const { error } = await admin.from("payments").insert({ order_id: id, amount, method_id: paymentMethodId, paid_at: new Date().toISOString() });
    if (error) throw error;
  };

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    for (const role of ["owner", "operations", "viewer"] as Role[]) await signIn(role);
    retailUnitId = (await admin.from("business_units").select("id").eq("code", "retail").single()).data!.id;
    wholesaleUnitId = (await admin.from("business_units").select("id").eq("code", "wholesale").single()).data!.id;
    locationId = (await admin.from("locations").select("id").limit(1).single()).data!.id;
    paymentMethodId = (await admin.from("payment_methods").select("id").limit(1).single()).data!.id;
    customerId = (await admin.from("customers").insert({ first_name: `ZZMod ${RUN}` }).select("id").single()).data!.id;
  });

  afterAll(async () => {
    if (paths.length) await admin.storage.from(ORDER_ATTACHMENTS_BUCKET).remove(paths);
    await cleanupFixtures(
      admin,
      "modify-order",
      { orderIds, productIds, customerIds: [customerId, ...customerIds] },
      async (step) => {
        for (const orderId of orderIds) await step("production_orders", () => admin.from("production_orders").delete().eq("order_id", orderId));
      }
    );
  });

  describe("agregar ítems (pending)", () => {
    it("agrega un producto: total nuevo, ítem creado, totales del pedido recalculados por el trigger y una fila en order_adjustments", async () => {
      const a = await makeVariant(0);
      const b = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 20, unit_price: 9000 }] });
      expect(Number((await order(id)).total)).toBe(180000);

      const { data: adjId, error } = await modify(id, [{ op: "add", product_variant_id: b.variantId, quantity: 1, unit_price: 12000 }], "  pidieron una taza más  ");
      expect(error).toBeNull();

      const after = await order(id);
      expect(Number(after.subtotal)).toBe(192000);
      expect(Number(after.total)).toBe(192000);
      expect(await itemsOf(id)).toHaveLength(2);

      const [adj] = await adjustments(id);
      expect(adj).toMatchObject({ id: adjId, reason: "pidieron una taza más", status_at_change: "pending", after_delivery: false, created_by: ids.operations });
      expect([Number(adj.subtotal_before), Number(adj.subtotal_after), Number(adj.total_before), Number(adj.total_after)]).toEqual([180000, 192000, 180000, 192000]);
      expect(adj.changes).toHaveLength(1);
      expect(adj.changes[0]).toMatchObject({ op: "add", product_variant_id: b.variantId, quantity_before: 0, quantity_after: 1, stock: "none" });
    });

    it("agrega un ítem personalizado", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }] });
      expect((await modify(id, [{ op: "add", custom_name: " Taza con logo ", custom_description: "azul", quantity: 3, unit_price: 500 }])).error).toBeNull();
      const custom = (await itemsOf(id)).find((i) => i.product_variant_id === null);
      expect(custom).toMatchObject({ custom_name: "Taza con logo", custom_description: "azul", quantity: 3 });
      expect(Number((await order(id)).total)).toBe(1600);
    });

    it("varios cambios en UNA sola modificación (una fila, todo o nada)", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 2, unit_price: 100 }] });
      const { error } = await modify(id, [
        { op: "add", custom_name: "Extra 1", quantity: 1, unit_price: 50 },
        { op: "add", custom_name: "Extra 2", quantity: 1, unit_price: 70 },
      ]);
      expect(error).toBeNull();
      expect(await adjustments(id)).toHaveLength(1);
      expect(Number((await order(id)).total)).toBe(320);

      // Un cambio inválido en el medio deshace TODO.
      const bad = await modify(id, [{ op: "add", custom_name: "Bueno", quantity: 1, unit_price: 10 }, { op: "set_quantity", order_item_id: "00000000-0000-4000-8000-000000000000", quantity: 2 }]);
      expect(bad.error?.message).toMatch(/no pertenece/);
      expect(await itemsOf(id)).toHaveLength(3);
      expect(await adjustments(id)).toHaveLength(1);
      expect(Number((await order(id)).total)).toBe(320);
    });
  });

  describe("pagos intactos y saldo recalculado", () => {
    it("pedido parcialmente pagado: los pagos no cambian y el saldo es nuevo total − pagos", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 20, unit_price: 9000 }] });
      await pay(id, 100000);
      const before = await paymentsOf(id);

      await modify(id, [{ op: "add", custom_name: "Taza", quantity: 1, unit_price: 12000 }]);

      expect(await paymentsOf(id)).toEqual(before);
      expect(await balanceOf(id)).toMatchObject({ total: 192000, paid_total: 100000, balance: 92000 });
    });

    it("pedido TOTALMENTE pagado que pasa a tener saldo (y entra al KPI de pendiente)", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 1000 }] });
      await pay(id, 1000);
      expect(Number((await balanceOf(id)).balance)).toBe(0);

      await modify(id, [{ op: "add", custom_name: "Pieza posterior", quantity: 1, unit_price: 250 }]);
      expect(Number((await balanceOf(id)).balance)).toBe(250);
      const { data } = await clients.operations.rpc("get_orders_receivable", { p_business_unit_id: retailUnitId });
      expect(Number((data as { pending_total: string }[])[0].pending_total)).toBeGreaterThanOrEqual(250);
    });
  });

  describe("cantidades y quitar según el estado", () => {
    it("pending: subir, bajar y quitar un ítem; el pedido conserva al menos uno", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({
        items: [{ product_variant_id: a.variantId, quantity: 4, unit_price: 100 }, { custom_name: "Otro", quantity: 2, unit_price: 50 }],
      });
      const [cat, cus] = [(await itemsOf(id)).find((i) => i.product_variant_id)!, (await itemsOf(id)).find((i) => !i.product_variant_id)!];

      expect((await modify(id, [{ op: "set_quantity", order_item_id: cat.id, quantity: 6 }])).error).toBeNull();
      expect((await modify(id, [{ op: "set_quantity", order_item_id: cat.id, quantity: 3 }])).error).toBeNull();
      expect(Number((await order(id)).total)).toBe(3 * 100 + 2 * 50);

      expect((await modify(id, [{ op: "remove", order_item_id: cus.id }])).error).toBeNull();
      expect(await itemsOf(id)).toHaveLength(1);
      const lines = (await adjustments(id)).flatMap((a) => a.changes as Change[]);
      expect(lines.find((l) => l.op === "remove")).toMatchObject({ order_item_id: cus.id, label: "Otro", quantity_before: 2, quantity_after: 0 });

      // El rastro del ítem quitado sobrevive (sin FK a order_items).
      expect((await modify(id, [{ op: "remove", order_item_id: cat.id }])).error?.message).toMatch(/al menos un ítem/);
      expect(await itemsOf(id)).toHaveLength(1);
    });

    it("rechaza cantidad sin cambio, inválida y operaciones desconocidas", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 4, unit_price: 100 }] });
      const item = (await itemsOf(id))[0];
      expect((await modify(id, [{ op: "set_quantity", order_item_id: item.id, quantity: 4 }])).error?.message).toMatch(/no cambió/);
      expect((await modify(id, [{ op: "set_quantity", order_item_id: item.id, quantity: 0 }])).error?.message).toMatch(/Cantidad inválida/);
      expect((await modify(id, [{ op: "teleport" }])).error?.message).toMatch(/Operación desconocida/);
      expect(await adjustments(id)).toHaveLength(0);
    });

    it("un descuento mayor al nuevo subtotal revierte todo", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({
        items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 1000 }, { custom_name: "Chico", quantity: 1, unit_price: 100 }],
        discount: 500,
      });
      const big = (await itemsOf(id)).find((i) => i.product_variant_id)!;
      const r = await modify(id, [{ op: "remove", order_item_id: big.id }]);
      expect(r.error?.message).toMatch(/descuento/i);
      expect(await itemsOf(id)).toHaveLength(2);
      // El descuento se cargó a mano (no recalcula solo): el total no cambió por el intento fallido.
      expect(Number((await order(id)).total)).toBe(1100);
    });
  });

  describe("pedido confirmado: stock, reservas y producción", () => {
    it("agregar con stock disponible reserva lo agregado y no genera producción", async () => {
      const a = await makeVariant(10);
      const b = await makeVariant(10);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 2, unit_price: 100 }], status: "confirmed" });
      const reservedBefore = await activeReservedOf(id);

      const { error } = await modify(id, [{ op: "add", product_variant_id: b.variantId, quantity: 3, unit_price: 100 }]);
      expect(error).toBeNull();
      expect(await activeReservedOf(id)).toBe(reservedBefore + 3);
      expect(await productionOf(id)).toHaveLength(0);
      expect((await adjustments(id))[0].changes[0]).toMatchObject({ stock: "reserved", reserved: 3, to_produce: 0 });
    });

    it("agregar sin stock suficiente reserva lo que hay y manda a producir el resto (origen según la unidad)", async () => {
      const a = await makeVariant(10);
      const b = await makeVariant(2);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }], status: "confirmed", unitId: wholesaleUnitId });

      expect((await modify(id, [{ op: "add", product_variant_id: b.variantId, quantity: 5, unit_price: 100 }])).error).toBeNull();
      expect(await activeReservedOf(id)).toBe(1 + 2);
      const production = await productionOf(id);
      expect(production).toHaveLength(1);
      expect(production[0]).toMatchObject({ quantity: 3, origin: "wholesale_order" });
      expect(production[0].notes).toMatch(/modificar/);
    });

    it("subir la cantidad de un ítem de catálogo reserva sólo la diferencia", async () => {
      const a = await makeVariant(20);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 5, unit_price: 100 }], status: "confirmed" });
      const item = (await itemsOf(id))[0];
      expect(await activeReservedOf(id)).toBe(5);
      expect((await modify(id, [{ op: "set_quantity", order_item_id: item.id, quantity: 8 }])).error).toBeNull();
      expect(await activeReservedOf(id)).toBe(8);
    });

    it("reducir o quitar un ítem de CATÁLOGO se bloquea (stock reservado / producción); nada cambia", async () => {
      const a = await makeVariant(20);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 5, unit_price: 100 }, { custom_name: "Extra", quantity: 2, unit_price: 10 }], status: "confirmed" });
      const cat = (await itemsOf(id)).find((i) => i.product_variant_id)!;

      expect((await modify(id, [{ op: "set_quantity", order_item_id: cat.id, quantity: 2 }])).error?.message).toMatch(/sólo se permite mientras el pedido está pendiente/);
      expect((await modify(id, [{ op: "remove", order_item_id: cat.id }])).error?.message).toMatch(/sólo se permite mientras el pedido está pendiente/);
      expect((await itemsOf(id)).find((i) => i.id === cat.id)!.quantity).toBe(5);
      expect(await activeReservedOf(id)).toBe(5);
      expect(await adjustments(id)).toHaveLength(0);
    });

    it("un ítem PERSONALIZADO sí se puede reducir y quitar (no hay stock de por medio)", async () => {
      const a = await makeVariant(20);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }, { custom_name: "Extra", quantity: 4, unit_price: 10 }], status: "confirmed" });
      const custom = (await itemsOf(id)).find((i) => !i.product_variant_id)!;
      expect((await modify(id, [{ op: "set_quantity", order_item_id: custom.id, quantity: 2 }])).error).toBeNull();
      expect((await modify(id, [{ op: "remove", order_item_id: custom.id }])).error).toBeNull();
      expect(await itemsOf(id)).toHaveLength(1);
    });
  });

  describe("pedido ENTREGADO: ítems posteriores", () => {
    const deliveredOrder = async (stockA = 10) => {
      const a = await makeVariant(stockA);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 2, unit_price: 100 }], status: "delivered" });
      return { id, a };
    };

    it("agrega un ítem, descuenta stock (checkbox encendido), NO toca sold_at, sale_date, estado ni pagos", async () => {
      const { id } = await deliveredOrder();
      const b = await makeVariant(5);
      await pay(id, 200);
      const before = await order(id);
      expect(before.status).toBe("delivered");
      expect(before.sold_at).not.toBeNull();
      const paymentsBefore = await paymentsOf(id);

      const { error } = await modify(id, [{ op: "add", product_variant_id: b.variantId, quantity: 2, unit_price: 100 }], "pieza pedida después de la entrega", true);
      expect(error).toBeNull();

      const after = await order(id);
      expect(after.sold_at).toBe(before.sold_at);
      expect(after.sale_date).toBe(before.sale_date);
      expect(after.status).toBe("delivered");
      expect(Number(after.total)).toBe(400);
      expect(await paymentsOf(id)).toEqual(paymentsBefore);
      expect(Number((await balanceOf(id)).balance)).toBe(200);

      expect(await stockOf(b.inventoryItemId)).toBe(3); // 5 − 2
      const { data: movement } = await admin.from("inventory_movements").select("movement_type,quantity,reference_table,reference_id,created_by,reason").eq("inventory_item_id", b.inventoryItemId).eq("movement_type", "sale").single();
      expect(movement).toMatchObject({ movement_type: "sale", reference_table: "orders", reference_id: id, created_by: ids.operations });
      expect(Number(movement!.quantity)).toBe(-2);

      const [adj] = await adjustments(id);
      expect(adj).toMatchObject({ status_at_change: "delivered", after_delivery: true, consume_stock: true });
      expect(adj.changes[0]).toMatchObject({ stock: "consumed" });
    });

    it("con 'Descontar del stock' APAGADO no mueve stock y lo registra", async () => {
      const { id } = await deliveredOrder();
      const b = await makeVariant(5);
      expect((await modify(id, [{ op: "add", product_variant_id: b.variantId, quantity: 2, unit_price: 100 }], "ya se descontó", false)).error).toBeNull();
      expect(await stockOf(b.inventoryItemId)).toBe(5);
      const [adj] = await adjustments(id);
      expect(adj).toMatchObject({ after_delivery: true, consume_stock: false });
      expect(adj.changes[0]).toMatchObject({ stock: "not_consumed" });
    });

    it("sin stock suficiente y con el checkbox encendido: error claro y NADA cambia (atómico)", async () => {
      const { id } = await deliveredOrder();
      const b = await makeVariant(1);
      const r = await modify(id, [{ op: "add", custom_name: "Otra", quantity: 1, unit_price: 5 }, { op: "add", product_variant_id: b.variantId, quantity: 3, unit_price: 100 }], "x", true);
      expect(r.error?.message).toMatch(/No hay stock suficiente.*Desmarcá "Descontar del stock"/);
      expect(await itemsOf(id)).toHaveLength(1);
      expect(await adjustments(id)).toHaveLength(0);
      expect(await stockOf(b.inventoryItemId)).toBe(1);
    });

    it("subir cantidad de un ítem también descuenta la diferencia; reducir o quitar se rechaza (es historia)", async () => {
      const { id, a } = await deliveredOrder(10);
      const item = (await itemsOf(id))[0];
      const stockBefore = await stockOf(a.inventoryItemId);
      expect((await modify(id, [{ op: "set_quantity", order_item_id: item.id, quantity: 5 }])).error).toBeNull();
      expect(await stockOf(a.inventoryItemId)).toBe(stockBefore - 3);

      expect((await modify(id, [{ op: "set_quantity", order_item_id: item.id, quantity: 1 }])).error?.message).toMatch(/ya fue entregado.*reducir/);
      expect((await modify(id, [{ op: "remove", order_item_id: item.id }])).error?.message).toMatch(/ya fue entregado.*quitar/);
      expect((await itemsOf(id))[0].quantity).toBe(5);
    });

    it("un ítem personalizado en un pedido entregado tampoco se reduce ni se quita", async () => {
      const a = await makeVariant(5);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }, { custom_name: "Custom", quantity: 3, unit_price: 10 }], status: "delivered" });
      const custom = (await itemsOf(id)).find((i) => !i.product_variant_id)!;
      expect((await modify(id, [{ op: "set_quantity", order_item_id: custom.id, quantity: 1 }])).error?.message).toMatch(/entregado/);
      expect((await modify(id, [{ op: "remove", order_item_id: custom.id }])).error?.message).toMatch(/entregado/);
      expect((await modify(id, [{ op: "set_quantity", order_item_id: custom.id, quantity: 5 }])).error).toBeNull();
    });
  });

  describe("validaciones y permisos", () => {
    it("motivo obligatorio, sin cambios, pedido inexistente, cancelado y venta rápida", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }] });
      const add = [{ op: "add", custom_name: "x", quantity: 1, unit_price: 1 }];

      for (const reason of [null, "", "   "]) expect((await modify(id, add, reason)).error?.message).toMatch(/motivo.*obligatorio/);
      expect((await modify(id, add, "x".repeat(301))).error?.message).toMatch(/300/);
      expect((await modify(id, [])).error?.message).toMatch(/No hay cambios/);
      expect((await modify("00000000-0000-4000-8000-000000000000", add)).error?.message).toMatch(/no existe/);

      await admin.from("orders").update({ status: "cancelled" }).eq("id", id);
      expect((await modify(id, add)).error?.message).toMatch(/cancelado/);

      const rs = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }] });
      await admin.from("orders").update({ operation_type: "retail_sale" }).eq("id", rs);
      expect((await modify(rs, add)).error?.message).toMatch(/ventas rápidas/);
      expect(await adjustments(id)).toHaveLength(0);
    });

    it("ítem inactivo/inexistente y un ítem de OTRO pedido se rechazan", async () => {
      const a = await makeVariant(0);
      const inactive = await makeVariant(0);
      await admin.from("product_variants").update({ is_active: false }).eq("id", inactive.variantId);
      const id1 = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }] });
      const id2 = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }] });
      const foreignItem = (await itemsOf(id2))[0];

      expect((await modify(id1, [{ op: "add", product_variant_id: inactive.variantId, quantity: 1, unit_price: 1 }])).error?.message).toMatch(/no está disponible/);
      expect((await modify(id1, [{ op: "set_quantity", order_item_id: foreignItem.id, quantity: 9 }])).error?.message).toMatch(/no pertenece/);
      expect((await itemsOf(id2))[0].quantity).toBe(1);
    });

    it("owner y operations pueden; viewer no", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }] });
      const add = [{ op: "add", custom_name: "x", quantity: 1, unit_price: 1 }];
      expect((await modify(id, add, "viewer", true, "viewer")).error?.message).toMatch(/No tenés permiso/);
      expect(await itemsOf(id)).toHaveLength(1);
      expect((await modify(id, add, "owner", true, "owner")).error).toBeNull();
      expect((await modify(id, add, "operations", true, "operations")).error).toBeNull();
      expect((await adjustments(id)).map((x) => x.created_by)).toEqual([ids.owner, ids.operations]);
    });

    it("anon no puede ejecutarla", async () => {
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      const r = await anon.rpc("modify_order", { p_order_id: "00000000-0000-4000-8000-000000000000", p_changes: [], p_reason: "x", p_consume_stock: true });
      expect(r.error).not.toBeNull();
      expect(r.error?.message).not.toMatch(/No hay cambios/);
    });
  });

  describe("toda escritura de líneas pasa por una función: ni INSERT, ni UPDATE, ni DELETE directos", () => {
    const stateOf = async (id: string) => ({ items: await itemsOf(id), total: Number((await order(id)).total), adjustments: (await adjustments(id)).length });

    it("INSERT directo de un order_item sobre un pedido EXISTENTE falla para owner, operations y viewer, en cualquier estado — y no deja ni ítem ni rastro", async () => {
      const a = await makeVariant(5);
      const pending = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 2, unit_price: 100 }] });
      const confirmed = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }], status: "confirmed" });
      const delivered = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }], status: "delivered" });

      for (const id of [pending, confirmed, delivered]) {
        const before = await stateOf(id);
        const reservedBefore = await activeReservedOf(id);
        for (const role of ["owner", "operations", "viewer"] as Role[]) {
          const direct = await clients[role].from("order_items").insert({ order_id: id, custom_name: "colado", quantity: 1, unit_price: 9999 });
          expect(direct.error).not.toBeNull();
          const catalog = await clients[role].from("order_items").insert({ order_id: id, product_variant_id: a.variantId, quantity: 1, unit_price: 9999 });
          expect(catalog.error).not.toBeNull();
        }
        // Ni el ítem, ni el total, ni la modificación registrada, ni las reservas cambiaron.
        expect(await stateOf(id)).toEqual(before);
        expect(await activeReservedOf(id)).toBe(reservedBefore);
      }
    });

    it("anon tampoco puede escribir order_items", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }] });
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      expect((await anon.from("order_items").insert({ order_id: id, custom_name: "anon", quantity: 1, unit_price: 1 })).error).not.toBeNull();
      expect(await itemsOf(id)).toHaveLength(1);
    });

    it("UPDATE y DELETE directos (owner, operations, viewer) siguen bloqueados y no cambian nada", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 4, unit_price: 100 }] });
      const before = await stateOf(id);
      for (const role of ["owner", "operations", "viewer"] as Role[]) {
        const upd = await clients[role].from("order_items").update({ quantity: 99, unit_price: 1 }).eq("id", before.items[0].id);
        const del = await clients[role].from("order_items").delete().eq("id", before.items[0].id);
        expect(upd.error).not.toBeNull();
        expect(del.error).not.toBeNull();
      }
      expect(await stateOf(id)).toEqual(before);
    });

    it("la LECTURA de order_items sigue abierta a todos los roles autenticados", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }] });
      for (const role of ["owner", "operations", "viewer"] as Role[]) {
        const read = await clients[role].from("order_items").select("id").eq("order_id", id);
        expect(read.error).toBeNull();
        expect(read.data).toHaveLength(1);
      }
    });

    it("la creación inicial NORMAL sigue funcionando: create_order (owner y operations), con ítems de catálogo y personalizados", async () => {
      const a = await makeVariant(0);
      for (const role of ["owner", "operations"] as Role[]) {
        const { data: orderId, error } = await clients[role].rpc("create_order", {
          p_business_unit_id: retailUnitId, p_customer_id: customerId, p_location_id: locationId,
          p_origin_channel_id: null, p_closing_channel_id: null, p_delivery_method: null, p_delivery_address: null,
          p_estimated_date: null, p_notes: null,
          p_items: [{ product_variant_id: a.variantId, quantity: 3, unit_price: 100 }, { custom_name: "A medida", quantity: 1, unit_price: 50 }],
        });
        expect(error).toBeNull();
        orderIds.push(orderId as string);
        const created = await order(orderId as string);
        expect(Number(created.total)).toBe(350);
        expect(created.created_by).toBe(ids[role]); // auth.uid() sigue siendo quien llama
        expect(await itemsOf(orderId as string)).toHaveLength(2);
        // La creación inicial NO es una "modificación": no genera order_adjustments.
        expect(await adjustments(orderId as string)).toHaveLength(0);
      }
    });

    it("la service_role (scripts/importaciones) conserva la paridad con la RLS que siempre salteó: puede crear", async () => {
      const a = await makeVariant(0);
      const { data: orderId, error } = await admin.rpc("create_order", {
        p_business_unit_id: retailUnitId, p_customer_id: customerId, p_location_id: locationId,
        p_origin_channel_id: null, p_closing_channel_id: null, p_delivery_method: null, p_delivery_address: null,
        p_estimated_date: null, p_notes: null, p_items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 10 }],
      });
      expect(error).toBeNull();
      orderIds.push(orderId as string);
      expect(await itemsOf(orderId as string)).toHaveLength(1);
    });

    it("create_order: un viewer o anon se rechazan con un mensaje claro y no crean nada", async () => {
      const a = await makeVariant(0);
      const args = {
        p_business_unit_id: retailUnitId, p_customer_id: customerId, p_location_id: locationId,
        p_origin_channel_id: null, p_closing_channel_id: null, p_delivery_method: null, p_delivery_address: null,
        p_estimated_date: null, p_notes: `ZZ-${RUN}-sin-permiso`,
        p_items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }],
      };
      const viewer = await clients.viewer.rpc("create_order", args);
      expect(viewer.error?.message).toMatch(/No tenés permiso para crear pedidos/);
      const anon = await createClient(SUPABASE_URL, ANON_KEY).rpc("create_order", args);
      expect(anon.error).not.toBeNull();
      expect((await admin.from("orders").select("id").eq("notes", `ZZ-${RUN}-sin-permiso`)).data).toHaveLength(0);
    });

    it("las funciones *_impl NO son invocables por la API (no se puede esquivar el chequeo de rol del wrapper)", async () => {
      const a = await makeVariant(0);
      const r = await clients.operations.rpc("create_order_impl", {
        p_business_unit_id: retailUnitId, p_customer_id: customerId, p_location_id: locationId,
        p_origin_channel_id: null, p_closing_channel_id: null, p_delivery_method: null, p_delivery_address: null,
        p_estimated_date: null, p_notes: null, p_items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 1 }], p_sale_date: null,
      });
      expect(r.error).not.toBeNull();
      const q = await clients.owner.rpc("create_quick_retail_sale_impl", { p_location_id: locationId, p_items: [], p_payment_method_id: paymentMethodId, p_paid_at: new Date().toISOString() });
      expect(q.error).not.toBeNull();
    });

    it("modify_order SÍ puede agregar, y deja su fila en order_adjustments: es la única vía de modificar líneas", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }] });
      const direct = await clients.operations.from("order_items").insert({ order_id: id, custom_name: "directo", quantity: 1, unit_price: 5 });
      expect(direct.error).not.toBeNull();
      expect(await itemsOf(id)).toHaveLength(1);
      expect(await adjustments(id)).toHaveLength(0);

      expect((await modify(id, [{ op: "add", custom_name: "por modify_order", quantity: 1, unit_price: 5 }], "vía correcta")).error).toBeNull();
      expect(await itemsOf(id)).toHaveLength(2);
      const adj = await adjustments(id);
      expect(adj).toHaveLength(1);
      expect(adj[0].reason).toBe("vía correcta");
      // Cada línea agregada tiene su registro: no hay forma de sumar ítems sin rastro.
      expect(await itemsOf(id)).toHaveLength(1 + adj.flatMap((x) => x.changes as Change[]).filter((l) => l.op === "add").length);
    });

    it("el checkout público (submit_wholesale_request, anon) sigue creando pedidos con sus ítems", async () => {
      const a = await makeVariant(0);
      const productId = productIds[productIds.length - 1];
      const wholesaleListId = (await admin.from("price_lists").select("id").eq("code", "wholesale").single()).data!.id;
      await admin.from("price_list_items").insert({ price_list_id: wholesaleListId, product_variant_id: a.variantId, unit_price: 5000 });
      await admin.from("wholesale_product_rules").upsert({ product_id: productId, is_public: true, min_quantity: 1, multiple_of: 1 });

      const anon = createClient(SUPABASE_URL, ANON_KEY);
      const { data: humanCode, error } = await anon.rpc("submit_wholesale_request", {
        p_first_name: "ZZ", p_last_name: RUN, p_company_name: `${RUN} Checkout`, p_cuit: null, p_instagram: null, p_website: null,
        p_city: "Rosario", p_province: "Santa Fe", p_address: null, p_postal_code: null,
        p_whatsapp: `54911${Date.now().toString().slice(-8)}`, p_email: `zz-${RUN}-${Date.now()}@example.com`, p_notes: null,
        // 5 × $5.000 = $25.000: supera los mínimos mayoristas de la base local ($10.000 / 5 piezas).
        p_items: [{ product_variant_id: a.variantId, quantity: 5 }], p_client_request_id: crypto.randomUUID(),
      });
      expect(error).toBeNull();

      const { data: created } = await admin.from("orders").select("id,customer_id,total").eq("human_code", humanCode).single();
      orderIds.push(created!.id);
      if (created!.customer_id) customerIds.push(created!.customer_id);
      expect(await itemsOf(created!.id)).toHaveLength(1);
      expect(Number(created!.total)).toBe(25000);
    });
  });

  describe("hardening de EXECUTE de las funciones SECURITY DEFINER (sin depender de los defaults)", () => {
    const deniedByAcl = (r: { error: { code?: string; message: string } | null }) => {
      // 42501 = "permission denied for function": la ACL la frena ANTES de ejecutar nada
      // (distinto del mensaje en español P0001 que da el chequeo de rol DENTRO del wrapper).
      expect(r.error?.code).toBe("42501");
      // "for function": la denegación es de la ACL de la FUNCIÓN, no de un privilegio de tabla más adentro
      // (los *_impl tendrían además una segunda capa: sin privilegio de INSERT sobre order_items).
      expect(r.error?.message).toMatch(/permission denied for function/i);
    };
    const orderArgs = (variantId: string) => ({
      p_business_unit_id: retailUnitId, p_customer_id: customerId, p_location_id: locationId,
      p_origin_channel_id: null, p_closing_channel_id: null, p_delivery_method: null, p_delivery_address: null,
      p_estimated_date: null, p_notes: null, p_items: [{ product_variant_id: variantId, quantity: 1, unit_price: 1 }], p_sale_date: null,
    });
    const quickArgs = { p_location_id: "00000000-0000-4000-8000-000000000000", p_items: [], p_payment_method_id: "00000000-0000-4000-8000-000000000000", p_paid_at: new Date().toISOString() };
    const modifyArgs = { p_order_id: "00000000-0000-4000-8000-000000000000", p_changes: [], p_reason: "x", p_consume_stock: true };
    const effectArgs = { p_order: null, p_variant_id: "00000000-0000-4000-8000-000000000000", p_quantity: 1, p_consume_stock: true };

    it("anon (y PUBLIC implícito) NO puede ejecutar los wrappers ni modify_order", async () => {
      const a = await makeVariant(0);
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      deniedByAcl(await anon.rpc("create_order", orderArgs(a.variantId)));
      deniedByAcl(await anon.rpc("create_quick_retail_sale", quickArgs));
      deniedByAcl(await anon.rpc("modify_order", modifyArgs));
    });

    it("authenticated autorizado SÍ llega a los wrappers (owner y operations crean; la ACL no los frena)", async () => {
      const a = await makeVariant(0);
      for (const role of ["owner", "operations"] as Role[]) {
        const created = await clients[role].rpc("create_order", orderArgs(a.variantId));
        expect(created.error).toBeNull();
        orderIds.push(created.data as string);
      }
      // quick sale: llega a la función (no es 42501) aunque los datos inválidos la rechacen después.
      const quick = await clients.operations.rpc("create_quick_retail_sale", quickArgs);
      expect(quick.error?.code).not.toBe("42501");
      expect((await clients.operations.rpc("modify_order", modifyArgs)).error?.code).not.toBe("42501");
    });

    it("authenticated NO puede ejecutar los *_impl ni modify_order_stock_effect", async () => {
      const a = await makeVariant(0);
      for (const role of ["owner", "operations", "viewer"] as Role[]) {
        deniedByAcl(await clients[role].rpc("create_order_impl", orderArgs(a.variantId)));
        deniedByAcl(await clients[role].rpc("create_quick_retail_sale_impl", quickArgs));
        deniedByAcl(await clients[role].rpc("modify_order_stock_effect", effectArgs));
      }
    });

    it("anon NO puede ejecutar los *_impl ni modify_order_stock_effect", async () => {
      const a = await makeVariant(0);
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      deniedByAcl(await anon.rpc("create_order_impl", orderArgs(a.variantId)));
      deniedByAcl(await anon.rpc("create_quick_retail_sale_impl", quickArgs));
      deniedByAcl(await anon.rpc("modify_order_stock_effect", effectArgs));
    });

    it("ni siquiera la service_role (clave de servidor) puede ejecutar los *_impl, modify_order_stock_effect ni modify_order", async () => {
      const a = await makeVariant(0);
      deniedByAcl(await admin.rpc("create_order_impl", orderArgs(a.variantId)));
      deniedByAcl(await admin.rpc("create_quick_retail_sale_impl", quickArgs));
      deniedByAcl(await admin.rpc("modify_order_stock_effect", effectArgs));
      deniedByAcl(await admin.rpc("modify_order", modifyArgs));
    });
  });

  describe("order_adjustments e historial", () => {
    it("order_adjustments es inmutable por la API y legible por todos los roles", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }] });
      await modify(id, [{ op: "add", custom_name: "x", quantity: 1, unit_price: 1 }], "original");
      const [adj] = await adjustments(id);

      for (const role of ["owner", "operations", "viewer"] as Role[]) {
        expect((await clients[role].from("order_adjustments").insert({ order_id: id, reason: "falso", status_at_change: "pending", after_delivery: false, subtotal_before: 0, subtotal_after: 0, total_before: 0, total_after: 0, changes: [] })).error).not.toBeNull();
        await clients[role].from("order_adjustments").update({ reason: "editada" }).eq("id", adj.id);
        await clients[role].from("order_adjustments").delete().eq("id", adj.id);
        const { data } = await clients[role].from("order_adjustments").select("reason").eq("order_id", id);
        expect(data).toEqual([{ reason: "original" }]);
      }
    });

    it("un pedido pendiente CON modificaciones sigue pudiéndose eliminar (el historial se va con él)", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }] });
      await modify(id, [{ op: "add", custom_name: "x", quantity: 1, unit_price: 1 }]);
      expect((await clients.owner.rpc("delete_order_safe", { p_id: id, p_reason: "prueba" })).error).toBeNull();
      expect(await adjustments(id)).toHaveLength(0);
      await admin.from("order_deletions").delete().eq("order_id", id);
    });
  });

  describe("PDF desactualizado (derivado) y pedido del checkout modificado", () => {
    const attach = async (orderId: string, humanCode: string) => {
      paths.push(wholesalePdfStoragePath(orderId, humanCode));
      await storeWholesaleOrderPdf(admin, { orderId, humanCode, pdfBytes: Buffer.from("%PDF-1.4 x"), uploadedBy: null });
      return (await admin.from("order_attachments").select("generated_at").eq("order_id", orderId).eq("kind", "wholesale_request_pdf").single()).data!.generated_at as string;
    };

    it("el PDF queda desactualizado tras modificar y deja de estarlo al regenerar; regenerar sigue siendo una sola fila", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 100 }], unitId: wholesaleUnitId });
      const humanCode = (await order(id)).human_code as string;

      const generated = await attach(id, humanCode);
      expect(pdfStaleness({ pdfGeneratedAt: generated, lastAdjustmentAt: null })).toBe("none");

      await new Promise((r) => setTimeout(r, 20));
      await modify(id, [{ op: "add", custom_name: "x", quantity: 1, unit_price: 1 }]);
      const lastAdj = (await adjustments(id)).at(-1)!.created_at as string;
      expect(pdfStaleness({ pdfGeneratedAt: generated, lastAdjustmentAt: lastAdj })).toBe("stale");

      // No se regeneró solo: el archivo y la marca siguen siendo los de antes.
      const { data: row } = await admin.from("order_attachments").select("generated_at").eq("order_id", id).single();
      expect(row!.generated_at).toBe(generated);

      await new Promise((r) => setTimeout(r, 20));
      const regenerated = await attach(id, humanCode);
      expect(new Date(regenerated).getTime()).toBeGreaterThan(new Date(generated).getTime());
      expect(pdfStaleness({ pdfGeneratedAt: regenerated, lastAdjustmentAt: lastAdj })).toBe("none");
      expect(((await admin.from("order_attachments").select("id").eq("order_id", id).eq("kind", "wholesale_request_pdf")).data ?? [])).toHaveLength(1);
    });

    it("una solicitud del CHECKOUT modificada se emite como 'Pedido mayorista' (sin banner), con los snapshots y los ítems nuevos", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 2, unit_price: 100 }], unitId: wholesaleUnitId });
      await admin.from("orders").update({
        wholesale_buyer_snapshot: { first_name: "Congelada", last_name: null, company_name: `${RUN} Hablame de Amor`, cuit: null, instagram: null, website: null, city: "Rosario", province: "Santa Fe", address: null, postal_code: null, whatsapp: "5493410000000", email: null },
        wholesale_terms_snapshot: { min_order_amount: 200000, min_total_units: 20, lead_time_min_days: 15, lead_time_max_days: 25, payment_terms: "TÉRMINOS CONGELADOS", shipping_terms: null },
      }).eq("id", id);

      const render = async () => {
        const loaded = await loadWholesaleDocumentData(clients.operations, { orderId: id });
        if (!loaded.ok) throw new Error(`no cargó: ${loaded.reason}`);
        const bytes = await renderWholesaleOrderPdf({ humanCode: loaded.order.humanCode, createdAt: new Date(loaded.order.createdAt), buyer: loaded.order.buyer, terms: loaded.order.terms, items: loaded.order.items, kind: loaded.order.kind });
        const parser = new PDFParse({ data: bytes });
        const text = (await parser.getText()).text;
        await parser.destroy();
        return { kind: loaded.order.kind, text };
      };

      const original = await render();
      expect(original.kind).toBe("request");
      expect(original.text).toContain("SOLICITUD PENDIENTE DE CONFIRMACIÓN");

      await modify(id, [{ op: "add", custom_name: "Taza posterior a la entrega", quantity: 1, unit_price: 12000 }]);
      const modified = await render();
      expect(modified.kind).toBe("order");
      expect(modified.text).toContain("Pedido mayorista");
      expect(modified.text).not.toContain("SOLICITUD PENDIENTE");
      expect(modified.text).not.toContain("Pedido mínimo");
      expect(modified.text).toContain(`${RUN} Hablame de Amor`); // snapshot del comprador conservado
      expect(modified.text).toContain("TÉRMINOS CONGELADOS");
      expect(modified.text).toContain("Taza posterior a la entrega");
    });
  });

  describe("concurrencia", () => {
    it("dos modificaciones simultáneas se serializan: ninguna se pierde y el total es la suma", async () => {
      const a = await makeVariant(0);
      const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 1, unit_price: 1000 }] });
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => modify(id, [{ op: "add", custom_name: `Extra ${i}`, quantity: 1, unit_price: 100 }], `m${i}`))
      );
      expect(results.every((r) => r.error === null)).toBe(true);
      expect(await adjustments(id)).toHaveLength(5);
      expect(Number((await order(id)).total)).toBe(1500);
      expect(await itemsOf(id)).toHaveLength(6);
    });

    it("modificar vs confirmar a la vez: reservado + a producir = lo pedido, sin importar quién gane", async () => {
      for (let i = 0; i < 4; i++) {
        const a = await makeVariant(3);
        const b = await makeVariant(2);
        const id = await makeOrder({ items: [{ product_variant_id: a.variantId, quantity: 2, unit_price: 100 }] });
        await Promise.all([
          modify(id, [{ op: "add", product_variant_id: b.variantId, quantity: 5, unit_price: 100 }]),
          clients.operations.rpc("set_order_status", { p_order_id: id, p_new_status: "confirmed" }),
        ]);
        const production = (await productionOf(id)).reduce((s, p) => s + Number(p.quantity), 0);
        const ordered = (await itemsOf(id)).reduce((s, it) => s + it.quantity, 0);
        expect(await activeReservedOf(id)).toBe(await activeReservedOf(id)); // estable
        expect((await order(id)).status).toBe("confirmed");
        expect(ordered).toBe(7);
        expect((await activeReservedOf(id)) + production).toBe(ordered);
      }
    });
  });
});
