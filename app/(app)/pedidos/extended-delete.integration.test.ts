import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupFixtures } from "../../../tests/support/fixture-cleanup";

// Eliminación segura AMPLIADA (migración 20261018100000): checkout cancelado de prueba,
// cancelado con producción sin tocar y venta rápida cargada por error. Contra Supabase LOCAL
// real, con la sesión de cada rol. La eliminación simple y el resto de los bloqueos viven en
// delete-order.integration.test.ts.

type Role = "owner" | "operations" | "viewer";
let currentRole: Role = "owner";
let currentClient: SupabaseClient;
let currentUserId = "";

vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: currentUserId, roles: [currentRole] }),
  isOwner: (u: { roles: string[] }) => u.roles.includes("owner"),
  hasRole: (u: { roles: string[] }, r: string) => u.roles.includes(r),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => currentClient }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { deleteOrder } = await import("./actions");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";
const EMAILS: Record<Role, string> = {
  owner: "owner-test@pottery.local",
  operations: "operations-test@pottery.local",
  viewer: "viewer-test@pottery.local",
};
const RUN = `ZZXD${Date.now().toString(36)}`;

describe("eliminación segura ampliada (local)", { timeout: 60000 }, () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  const clients = {} as Record<Role, SupabaseClient>;
  const ids = {} as Record<Role, string>;
  let retailUnitId: string;
  let locationId: string;
  let paymentMethodId: string;
  let generalConditionId: string;
  let retailListId: string;
  let customerId: string;
  const orderIds: string[] = [];
  const productIds: string[] = [];
  const productionIds: string[] = [];
  const movementIds: string[] = [];

  const as = (role: Role) => {
    currentRole = role;
    currentClient = clients[role];
    currentUserId = ids[role];
  };
  beforeEach(() => as("owner"));

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

  /** Producto con variante única, precio minorista y `stock` unidades en la ubicación de prueba. */
  async function makeVariant(stock: number, price = 1000) {
    const { data: product, error } = await admin.from("products").insert({ name: `${RUN} Pieza ${productIds.length}`, is_active: true }).select("id").single();
    if (error) throw error;
    productIds.push(product.id);
    const variantId = (await admin.from("product_variants").select("id").eq("product_id", product.id).single()).data!.id as string;
    const inventoryItemId = (await admin.from("inventory_items").select("id").eq("product_variant_id", variantId).single()).data!.id as string;
    await admin.from("price_list_items").insert({ price_list_id: retailListId, product_variant_id: variantId, unit_price: price });
    if (stock > 0) {
      await admin.from("inventory_movements").insert({ inventory_item_id: inventoryItemId, location_id: locationId, movement_type: "production_in", quantity: stock });
    }
    return { variantId, inventoryItemId };
  }

  const stockOf = async (inventoryItemId: string) =>
    ((await admin.from("inventory_movements").select("quantity").eq("inventory_item_id", inventoryItemId).eq("location_id", locationId)).data ?? []).reduce(
      (s, m) => s + Number(m.quantity),
      0
    );

  /** Pedido común (ítem a medida: sin stock) cargado con la sesión de operations. */
  async function makeOrder(opts: { status?: "cancelled"; checkout?: boolean } = {}) {
    const { data: id, error } = await clients.operations.rpc("create_order", {
      p_business_unit_id: retailUnitId, p_customer_id: customerId, p_location_id: locationId,
      p_origin_channel_id: null, p_closing_channel_id: null, p_delivery_method: null, p_delivery_address: null,
      p_estimated_date: null, p_notes: null,
      p_items: [{ custom_name: `${RUN} a medida`, quantity: 1, unit_price: 500 }],
    });
    if (error) throw error;
    orderIds.push(id as string);
    if (opts.checkout) {
      await admin.from("orders").update({ wholesale_buyer_snapshot: { first_name: "Snap", whatsapp: "1" }, wholesale_terms_snapshot: { payment_terms: "x" } }).eq("id", id);
    }
    if (opts.status === "cancelled") await admin.from("orders").update({ status: "cancelled" }).eq("id", id);
    return id as string;
  }

  /** Venta rápida real (RPC) con los ítems [variante, cantidad]. Devuelve el pedido y su pago. */
  async function makeQuickSale(items: { variantId: string; quantity: number }[]) {
    const { data, error } = await clients.operations.rpc("create_quick_retail_sale", {
      p_location_id: locationId,
      p_items: items.map((i) => ({ product_variant_id: i.variantId, quantity: i.quantity })),
      p_payment_method_id: paymentMethodId,
      p_paid_at: new Date().toISOString(),
      p_customer_id: null, p_channel_id: null, p_payment_account_id: null, p_discount_total: 0, p_client_request_id: null,
      p_price_condition_id: generalConditionId,
    });
    if (error) throw error;
    const sale = (data as { order_id: string; human_code: string; total: number }[])[0];
    orderIds.push(sale.order_id);
    return sale;
  }

  async function makeProduction(orderId: string, variantId: string, over: Record<string, unknown> = {}) {
    const { data, error } = await admin.from("production_orders")
      .insert({ order_id: orderId, product_variant_id: variantId, location_id: locationId, quantity: 2, ...over }).select("id").single();
    if (error) throw error;
    productionIds.push(data.id);
    return data.id as string;
  }

  const exists = async (orderId: string) => (await admin.from("orders").select("id").eq("id", orderId).maybeSingle()).data !== null;
  const count = async (table: string, col: string, value: string) =>
    (await admin.from(table).select("*", { count: "exact", head: true }).eq(col, value)).count ?? 0;
  const classify = async (orderId: string, role: Role = "owner") => {
    const { data, error } = await clients[role].rpc("classify_order_for_delete", { p_id: orderId });
    if (error) throw error;
    return (data as Record<string, unknown>[])[0];
  };
  const del = (orderId: string, opts: { reason?: string | null; code?: string | null; confirmed?: boolean } = {}, role: Role = "owner") =>
    clients[role].rpc("delete_order_safe", { p_id: orderId, p_reason: opts.reason ?? null, p_confirm_code: opts.code ?? null, p_confirmed: opts.confirmed ?? false });
  const humanCodeOf = async (orderId: string) => (await admin.from("orders").select("human_code").eq("id", orderId).single()).data!.human_code as string;
  const deletionOf = async (orderId: string) => (await admin.from("order_deletions").select("*").eq("order_id", orderId).maybeSingle()).data;
  const addPayment = async (orderId: string) => {
    const { error } = await admin.from("payments").insert({ order_id: orderId, amount: 50, paid_at: new Date().toISOString() });
    if (error) throw error;
  };

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    anon = createClient(SUPABASE_URL, ANON_KEY);
    for (const role of ["owner", "operations", "viewer"] as Role[]) await signIn(role);
    retailUnitId = (await admin.from("business_units").select("id").eq("code", "retail").single()).data!.id;
    locationId = (await admin.from("locations").select("id").limit(1).single()).data!.id;
    paymentMethodId = (await admin.from("payment_methods").select("id").limit(1).single()).data!.id;
    generalConditionId = (await admin.from("price_conditions").select("id").eq("code", "general").single()).data!.id;
    retailListId = (await admin.from("price_lists").select("id").eq("code", "retail").single()).data!.id;
    customerId = (await admin.from("customers").insert({ first_name: `${RUN} Cliente` }).select("id").single()).data!.id;
  });

  afterAll(async () => {
    if (movementIds.length) await admin.from("inventory_movements").delete().in("id", movementIds);
    for (const orderId of orderIds) await admin.from("production_orders").delete().eq("order_id", orderId);
    if (productionIds.length) await admin.from("production_orders").delete().in("id", productionIds);
    for (const orderId of orderIds) await admin.from("order_deletions").delete().eq("order_id", orderId);
    await cleanupFixtures(admin, "extended-delete", { orderIds, productIds, customerIds: [customerId] });
  });

  describe("cancelado con producción sin tocar (nivel 2)", () => {
    it("se elimina junto con su producción: sin confirmación obligatoria, motivo opcional, y queda auditado", async () => {
      const { variantId } = await makeVariant(0);
      const id = await makeOrder({ status: "cancelled" });
      const p1 = await makeProduction(id, variantId, { status: "pending" });
      const p2 = await makeProduction(id, variantId, { status: "cancelled" });

      expect(await classify(id)).toMatchObject({ level: "untouched_production", deletable: true, requires_confirmation: false, requires_reason: false, production_orders_count: 2 });
      const { data, error } = await del(id);
      expect(error).toBeNull();
      expect((data as { human_code: string }[])[0].human_code).toBeTruthy();

      expect(await exists(id)).toBe(false);
      for (const p of [p1, p2]) expect((await admin.from("production_orders").select("id").eq("id", p).maybeSingle()).data).toBeNull();
      const audit = await deletionOf(id);
      expect(audit).toMatchObject({ deletion_level: "untouched_production", declared_test: false, deleted_by: ids.owner });
      expect((audit!.details as { production_orders: unknown[] }).production_orders).toHaveLength(2);
      // El cliente queda intacto.
      expect((await admin.from("customers").select("id").eq("id", customerId).maybeSingle()).data).not.toBeNull();
    });

    it("producción AVANZADA o con piezas producidas/rechazadas bloquea, y no se toca nada", async () => {
      const { variantId } = await makeVariant(0);
      const cases: Record<string, unknown>[] = [{ status: "modeling" }, { status: "pending", produced_quantity: 1 }, { status: "pending", rejected_quantity: 1 }, { status: "done", produced_quantity: 2 }];
      for (const over of cases) {
        const id = await makeOrder({ status: "cancelled" });
        const p = await makeProduction(id, variantId, over);
        const check = await classify(id);
        expect(check.deletable, JSON.stringify(over)).toBe(false);
        expect(check.block_message).toMatch(/movimientos asociados/);
        expect((await del(id)).error?.message).toMatch(/movimientos asociados/);
        expect(await exists(id)).toBe(true);
        expect((await admin.from("production_orders").select("order_id").eq("id", p).single()).data!.order_id).toBe(id);
        expect(await deletionOf(id)).toBeNull();
      }
    });

    it("una orden sin tocar junto a otra avanzada: bloquea y NINGUNA se borra", async () => {
      const { variantId } = await makeVariant(0);
      const id = await makeOrder({ status: "cancelled" });
      const a = await makeProduction(id, variantId, { status: "pending" });
      const b = await makeProduction(id, variantId, { status: "glazing" });
      expect((await del(id)).error?.message).toMatch(/movimientos asociados/);
      for (const p of [a, b]) expect((await admin.from("production_orders").select("id").eq("id", p).maybeSingle()).data).not.toBeNull();
    });

    it("un pedido NO cancelado con producción sin tocar sigue bloqueado (se cancela primero)", async () => {
      const { variantId } = await makeVariant(0);
      const id = await makeOrder();
      await makeProduction(id, variantId, { status: "pending" });
      expect(await classify(id)).toMatchObject({ deletable: false, level: null });
      expect((await del(id)).error?.message).toMatch(/movimientos asociados.*Podés cancelarlo/);
      expect(await exists(id)).toBe(true);
    });
  });

  describe("checkout cancelado de prueba (nivel 3a)", () => {
    it("classify: exige confirmación y motivo; sin ellos NO borra nada (se validan en la base)", async () => {
      const id = await makeOrder({ status: "cancelled", checkout: true });
      const code = await humanCodeOf(id);
      expect(await classify(id)).toMatchObject({ level: "test_checkout", deletable: true, requires_confirmation: true, requires_reason: true, from_checkout: true });

      const attempts: [Parameters<typeof del>[1], RegExp][] = [
        [{ reason: "prueba", code, confirmed: false }, /confirmar/],
        [{ reason: null, code, confirmed: true }, /motivo/],
        [{ reason: "   ", code, confirmed: true }, /motivo/],
        [{ reason: "prueba", code: null, confirmed: true }, /código/],
        [{ reason: "prueba", code: "MAY-999999", confirmed: true }, /código/],
        [{ reason: "prueba", code: `${code}x`, confirmed: true }, /código/],
      ];
      for (const [opts, message] of attempts) {
        const { error } = await del(id, opts);
        expect(error?.message, JSON.stringify(opts)).toMatch(message);
        expect(await exists(id)).toBe(true);
      }
      expect(await deletionOf(id)).toBeNull();
    });

    it("con confirmación + motivo + código (sin importar mayúsculas ni espacios): se elimina y deja el snapshot del comprador", async () => {
      const id = await makeOrder({ status: "cancelled", checkout: true });
      const code = await humanCodeOf(id);
      const { error } = await del(id, { reason: "era una prueba del checkout", code: `  ${code.toLowerCase()} `, confirmed: true });
      expect(error).toBeNull();
      expect(await exists(id)).toBe(false);
      expect(await count("order_items", "order_id", id)).toBe(0);
      const audit = await deletionOf(id);
      expect(audit).toMatchObject({ deletion_level: "test_checkout", declared_test: true, reason: "era una prueba del checkout", human_code: code, deleted_by: ids.owner });
      expect((audit!.details as { wholesale_buyer_snapshot: { first_name: string } }).wholesale_buyer_snapshot.first_name).toBe("Snap");
      expect((audit!.details as { items: unknown[] }).items).toHaveLength(1);
      // El cliente (comprador) queda intacto.
      expect((await admin.from("customers").select("id").eq("id", customerId).maybeSingle()).data).not.toBeNull();
    });

    it("con producción sin tocar: se elimina también esa producción", async () => {
      const { variantId } = await makeVariant(0);
      const id = await makeOrder({ status: "cancelled", checkout: true });
      const p = await makeProduction(id, variantId, { status: "pending" });
      expect((await del(id, { reason: "prueba", code: await humanCodeOf(id), confirmed: true })).error).toBeNull();
      expect((await admin.from("production_orders").select("id").eq("id", p).maybeSingle()).data).toBeNull();
    });

    it("NO se puede con consecuencias reales: pagos (caso MAY-000039), movimientos o producción efectiva", async () => {
      const { variantId, inventoryItemId } = await makeVariant(0);
      const withPayment = await makeOrder({ status: "cancelled", checkout: true });
      await addPayment(withPayment);
      const withMovement = await makeOrder({ status: "cancelled", checkout: true });
      const { data: m } = await admin.from("inventory_movements")
        .insert({ inventory_item_id: inventoryItemId, location_id: locationId, movement_type: "sale", quantity: -1, reference_table: "orders", reference_id: withMovement }).select("id").single();
      movementIds.push(m!.id);
      const withProduction = await makeOrder({ status: "cancelled", checkout: true });
      await makeProduction(withProduction, variantId, { status: "first_firing" });

      for (const id of [withPayment, withMovement, withProduction]) {
        const check = await classify(id);
        expect(check).toMatchObject({ deletable: false, level: null });
        const code = await humanCodeOf(id);
        expect((await del(id, { reason: "prueba", code, confirmed: true })).error?.message).toMatch(/movimientos asociados/);
        expect(await exists(id)).toBe(true);
      }
      expect(await count("payments", "order_id", withPayment)).toBe(1);
    });

    it("un checkout NO cancelado sigue siendo una solicitud real: bloquea y ofrece cancelar", async () => {
      const id = await makeOrder({ checkout: true });
      expect(await classify(id)).toMatchObject({ deletable: false });
      expect((await del(id, { reason: "x", code: await humanCodeOf(id), confirmed: true })).error?.message).toMatch(/solicitud del checkout mayorista.*Podés cancelarlo/);
      expect(await exists(id)).toBe(true);
    });
  });

  describe("venta rápida (nivel 3b)", () => {
    it("classify: nivel quick_sale con lo que se pierde (pagos y unidades a devolver)", async () => {
      const { variantId } = await makeVariant(5, 1000);
      const sale = await makeQuickSale([{ variantId, quantity: 2 }]);
      expect(await classify(sale.order_id)).toMatchObject({
        level: "quick_sale", deletable: true, requires_confirmation: true, requires_reason: true,
        payments_count: 1, movements_count: 1, stock_units_to_return: 2, operation_type: "retail_sale", status: "delivered",
      });
      expect(Number((await classify(sale.order_id)).payments_total)).toBe(2000);
    });

    it("se elimina: el stock vuelve por un `return` compensatorio, el `sale` original NO se borra, los pagos quedan en la auditoría", async () => {
      const { variantId, inventoryItemId } = await makeVariant(5, 1000);
      const sale = await makeQuickSale([{ variantId, quantity: 2 }]);
      expect(await stockOf(inventoryItemId)).toBe(3);
      const { data: before } = await admin.from("inventory_movements").select("id,movement_type,quantity").eq("reference_id", sale.order_id);
      expect(before).toHaveLength(1);

      const { error } = await del(sale.order_id, { reason: "se cargó dos veces", code: sale.human_code, confirmed: true });
      expect(error).toBeNull();

      expect(await exists(sale.order_id)).toBe(false);
      expect(await count("payments", "order_id", sale.order_id)).toBe(0);
      expect(await stockOf(inventoryItemId)).toBe(5);

      const { data: after } = await admin.from("inventory_movements").select("id,movement_type,quantity,reference_table,reason,created_by").eq("reference_id", sale.order_id).order("created_at");
      expect(after).toHaveLength(2);
      expect(after!.find((m) => m.id === before![0].id)).toMatchObject({ movement_type: "sale", quantity: -2 }); // el original sigue
      expect(after!.find((m) => m.movement_type === "return")).toMatchObject({ quantity: 2, reference_table: "orders", created_by: ids.owner });
      expect(after!.find((m) => m.movement_type === "return")!.reason).toContain(sale.human_code);

      const audit = await deletionOf(sale.order_id);
      expect(audit).toMatchObject({ deletion_level: "quick_sale", declared_test: false, reason: "se cargó dos veces", total: 2000, deleted_by: ids.owner });
      const details = audit!.details as { payments: { amount: number }[]; items: { quantity: number }[]; movements: unknown[]; stock_units_returned: number; payments_total: number };
      expect(details.payments).toHaveLength(1);
      expect(Number(details.payments[0].amount)).toBe(2000);
      expect(details.items).toHaveLength(1);
      expect(details.movements).toHaveLength(1);
      expect(details.stock_units_returned).toBe(2);
      expect(Number(details.payments_total)).toBe(2000);
    });

    it("varios ítems / varios pagos: repone cada ítem y registra todos los pagos", async () => {
      const a = await makeVariant(4, 500);
      const b = await makeVariant(6, 800);
      const sale = await makeQuickSale([{ variantId: a.variantId, quantity: 3 }, { variantId: b.variantId, quantity: 1 }]);
      await admin.from("payments").insert({ order_id: sale.order_id, amount: 100, paid_at: new Date().toISOString(), method_id: paymentMethodId });
      expect(await stockOf(a.inventoryItemId)).toBe(1);
      expect(await stockOf(b.inventoryItemId)).toBe(5);

      expect((await del(sale.order_id, { reason: "error", code: sale.human_code, confirmed: true })).error).toBeNull();
      expect(await stockOf(a.inventoryItemId)).toBe(4);
      expect(await stockOf(b.inventoryItemId)).toBe(6);
      expect(((await deletionOf(sale.order_id))!.details as { payments: unknown[] }).payments).toHaveLength(2);
    });

    it("sin motivo, sin confirmar o con el código mal: error y NADA cambia (pedido, pago y stock)", async () => {
      const { variantId, inventoryItemId } = await makeVariant(5, 1000);
      const sale = await makeQuickSale([{ variantId, quantity: 2 }]);
      const attempts: [Parameters<typeof del>[1], RegExp][] = [
        [{ reason: null, code: sale.human_code, confirmed: true }, /motivo/],
        [{ reason: "x", code: sale.human_code, confirmed: false }, /confirmar/],
        [{ reason: "x", code: "otro", confirmed: true }, /código/],
        [{ reason: "x", code: null, confirmed: true }, /código/],
      ];
      for (const [opts, message] of attempts) {
        expect((await del(sale.order_id, opts)).error?.message, JSON.stringify(opts)).toMatch(message);
      }
      expect(await exists(sale.order_id)).toBe(true);
      expect(await count("payments", "order_id", sale.order_id)).toBe(1);
      expect(await stockOf(inventoryItemId)).toBe(3);
      expect(await count("inventory_movements", "reference_id", sale.order_id)).toBe(1);
      expect(await deletionOf(sale.order_id)).toBeNull();
    });

    it("sólo owner: operations y viewer no pueden (nada cambia)", async () => {
      const { variantId, inventoryItemId } = await makeVariant(5, 1000);
      const sale = await makeQuickSale([{ variantId, quantity: 1 }]);
      for (const role of ["operations", "viewer"] as Role[]) {
        expect((await del(sale.order_id, { reason: "x", code: sale.human_code, confirmed: true }, role)).error?.message).toMatch(/Sólo la administradora/);
      }
      expect(await exists(sale.order_id)).toBe(true);
      expect(await stockOf(inventoryItemId)).toBe(4);
    });

    it("con un movimiento ajeno a la venta (p. ej. un ajuste referenciando el pedido): bloquea", async () => {
      const { variantId, inventoryItemId } = await makeVariant(5, 1000);
      const sale = await makeQuickSale([{ variantId, quantity: 1 }]);
      const { data: m } = await admin.from("inventory_movements")
        .insert({ inventory_item_id: inventoryItemId, location_id: locationId, movement_type: "adjustment", quantity: -1, reference_table: "orders", reference_id: sale.order_id }).select("id").single();
      movementIds.push(m!.id);
      expect(await classify(sale.order_id)).toMatchObject({ deletable: false });
      expect((await del(sale.order_id, { reason: "x", code: sale.human_code, confirmed: true })).error?.message).toMatch(/no son de la propia venta/);
      expect(await exists(sale.order_id)).toBe(true);
      expect(await stockOf(inventoryItemId)).toBe(3);
    });

    it("dos eliminaciones simultáneas de la misma venta: una sola procede y el stock se repone UNA vez", async () => {
      const { variantId, inventoryItemId } = await makeVariant(5, 1000);
      const sale = await makeQuickSale([{ variantId, quantity: 2 }]);
      const opts = { reason: "doble clic", code: sale.human_code, confirmed: true };
      const [a, b] = await Promise.all([del(sale.order_id, opts), del(sale.order_id, opts)]);
      expect([a.error, b.error].filter((e) => e === null)).toHaveLength(1);
      expect(await stockOf(inventoryItemId)).toBe(5);
      expect((await admin.from("inventory_movements").select("id").eq("reference_id", sale.order_id).eq("movement_type", "return")).data).toHaveLength(1);
      expect(await count("order_deletions", "order_id", sale.order_id)).toBe(1);
    });

    it("otra venta del mismo producto no se afecta, y una venta nueva puede vender de nuevo el stock repuesto", async () => {
      const { variantId, inventoryItemId } = await makeVariant(3, 1000);
      const first = await makeQuickSale([{ variantId, quantity: 2 }]);
      const other = await makeQuickSale([{ variantId, quantity: 1 }]);
      expect(await stockOf(inventoryItemId)).toBe(0);
      expect((await del(first.order_id, { reason: "error", code: first.human_code, confirmed: true })).error).toBeNull();
      expect(await stockOf(inventoryItemId)).toBe(2);
      expect(await exists(other.order_id)).toBe(true);
      expect(await count("payments", "order_id", other.order_id)).toBe(1);
      expect(await makeQuickSale([{ variantId, quantity: 2 }])).toBeTruthy();
    });
  });

  describe("lo que nunca se borra y garantías comunes", () => {
    it("un pedido común entregado o con pagos NO es eliminable en ningún nivel", async () => {
      const delivered = await makeOrder();
      await admin.from("orders").update({ status: "delivered" }).eq("id", delivered);
      const paid = await makeOrder();
      await addPayment(paid);
      for (const id of [delivered, paid]) {
        expect(await classify(id)).toMatchObject({ deletable: false, level: null, requires_confirmation: false });
        const { error } = await del(id, { reason: "x", code: await humanCodeOf(id), confirmed: true });
        expect(error).not.toBeNull();
        expect(await exists(id)).toBe(true);
      }
      expect(await count("payments", "order_id", paid)).toBe(1);
    });

    it("la eliminación simple sigue igual: nivel simple, sin confirmación", async () => {
      const id = await makeOrder();
      expect(await classify(id)).toMatchObject({ level: "simple", deletable: true, requires_confirmation: false, requires_reason: false });
      expect((await del(id)).error).toBeNull();
      expect(await deletionOf(id)).toMatchObject({ deletion_level: "simple", declared_test: false });
    });

    it("el código humano de un pedido eliminado NO se reutiliza", async () => {
      const sale = await makeQuickSale([{ variantId: (await makeVariant(2)).variantId, quantity: 1 }]);
      expect((await del(sale.order_id, { reason: "x", code: sale.human_code, confirmed: true })).error).toBeNull();
      const next = await makeOrder();
      expect(await humanCodeOf(next)).not.toBe(sale.human_code);
    });

    it("ACL: anon no ejecuta ninguna de las dos funciones; viewer/operations sólo clasifican", async () => {
      const id = await makeOrder();
      for (const call of [
        anon.rpc("classify_order_for_delete", { p_id: id }),
        anon.rpc("delete_order_safe", { p_id: id }),
      ]) expect((await call).error?.message).toMatch(/permission denied for function/);
      expect(await exists(id)).toBe(true);
      expect((await del(id, {}, "operations")).error?.message).toMatch(/Sólo la administradora/);
    });

    it("order_deletions es append-only para la API y sólo la owner la lee", async () => {
      const id = await makeOrder();
      expect((await del(id)).error).toBeNull();
      const row = (await deletionOf(id))!;
      expect((await clients.owner.from("order_deletions").select("id").eq("id", row.id)).data).toHaveLength(1);
      expect((await clients.operations.from("order_deletions").select("id").eq("id", row.id)).data ?? []).toHaveLength(0);
      for (const role of ["owner", "operations"] as Role[]) {
        const upd = await clients[role].from("order_deletions").update({ reason: "falsificado" }).eq("id", row.id).select("id");
        const rm = await clients[role].from("order_deletions").delete().eq("id", row.id).select("id");
        expect(upd.data ?? []).toHaveLength(0);
        expect(rm.data ?? []).toHaveLength(0);
      }
      expect((await deletionOf(id))!.reason).toBeNull();
    });
  });

  describe("server action deleteOrder", () => {
    it("pasa la confirmación a la base: sin ella devuelve el mensaje claro y no borra; con ella elimina", async () => {
      const id = await makeOrder({ status: "cancelled", checkout: true });
      const code = await humanCodeOf(id);
      expect(await deleteOrder(id, "prueba")).toEqual({ error: "Tenés que confirmar la eliminación." });
      expect(await deleteOrder(id, "prueba", { confirmed: true })).toEqual({ error: "El código ingresado no coincide con el del pedido." });
      expect(await deleteOrder(id, undefined, { confirmed: true, confirmCode: code })).toEqual({ error: "Indicá el motivo de la eliminación." });
      expect(await exists(id)).toBe(true);
      expect(await deleteOrder(id, "prueba", { confirmed: true, confirmCode: code })).toEqual({});
      expect(await exists(id)).toBe(false);
    });

    it("venta rápida: elimina vía la acción y repone el stock; operations no puede", async () => {
      const { variantId, inventoryItemId } = await makeVariant(4, 1000);
      const sale = await makeQuickSale([{ variantId, quantity: 3 }]);
      as("operations");
      expect(await deleteOrder(sale.order_id, "x", { confirmed: true, confirmCode: sale.human_code })).toEqual({ error: "Sólo la administradora puede eliminar pedidos." });
      expect(await stockOf(inventoryItemId)).toBe(1);
      as("owner");
      expect(await deleteOrder(sale.order_id, "error de carga", { confirmed: true, confirmCode: sale.human_code })).toEqual({});
      expect(await stockOf(inventoryItemId)).toBe(4);
    });
  });
});
