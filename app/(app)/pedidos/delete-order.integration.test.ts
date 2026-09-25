import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupFixtures } from "../../../tests/support/fixture-cleanup";

// Eliminación segura de pedidos (classify_order_for_delete / delete_order_safe /
// server action deleteOrder) contra Supabase LOCAL real, con la sesión de cada
// rol. Se mockean sólo las costuras de Next (sesión, cliente de servidor,
// revalidatePath), igual que document-actions.integration.test.ts.

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
const BUCKET = "order-attachments";
const RUN = `ZZDEL${Date.now().toString(36)}`;

// Varias RPC y operaciones de Storage encadenadas por caso.
describe("eliminación segura de pedidos (local)", { timeout: 30000 }, () => {
  let admin: SupabaseClient;
  const clients = {} as Record<Role, SupabaseClient>;
  const ids = {} as Record<Role, string>;
  let unitId: string;
  let variantId: string;
  let inventoryItemId: string;
  let locationId: string;
  let customerId: string;
  const orderIds: string[] = [];
  const movementIds: string[] = [];
  const productionIds: string[] = [];
  const paths: string[] = [];

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

  /** Pedido cargado como lo hace /pedidos/nuevo (RPC create_order con la sesión de operations). */
  async function makeOrder(opts: { checkout?: boolean } = {}) {
    const { data: id, error } = await clients.operations.rpc("create_order", {
      p_business_unit_id: unitId, p_customer_id: customerId, p_location_id: locationId,
      p_origin_channel_id: null, p_closing_channel_id: null, p_delivery_method: null, p_delivery_address: null,
      p_estimated_date: null, p_notes: null,
      p_items: [
        { product_variant_id: variantId, quantity: 2, unit_price: 100 },
        { custom_name: `${RUN} ítem a medida`, quantity: 1, unit_price: 500 },
      ],
    });
    if (error) throw error;
    orderIds.push(id as string);
    if (opts.checkout) {
      await admin.from("orders").update({
        wholesale_buyer_snapshot: { first_name: "Snap", whatsapp: "1" },
        wholesale_terms_snapshot: { payment_terms: "x" },
      }).eq("id", id);
    }
    return id as string;
  }

  const exists = async (orderId: string) => (await admin.from("orders").select("id").eq("id", orderId).maybeSingle()).data !== null;
  const count = async (table: string, col: string, orderId: string) =>
    (await admin.from(table).select("*", { count: "exact", head: true }).eq(col, orderId)).count ?? 0;
  const classify = async (orderId: string, role: Role = "owner") => {
    const { data, error } = await clients[role].rpc("classify_order_for_delete", { p_id: orderId });
    if (error) throw error;
    return (data as Record<string, unknown>[])[0];
  };
  const del = (orderId: string, reason: string | null = null, role: Role = "owner") =>
    clients[role].rpc("delete_order_safe", { p_id: orderId, p_reason: reason });
  const addPayment = async (orderId: string) => {
    const { error } = await admin.from("payments").insert({ order_id: orderId, amount: 50, paid_at: new Date().toISOString() });
    if (error) throw error;
  };

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    for (const role of ["owner", "operations", "viewer"] as Role[]) await signIn(role);
    unitId = (await admin.from("business_units").select("id").eq("code", "retail").single()).data!.id;
    locationId = (await admin.from("locations").select("id").limit(1).single()).data!.id;
    variantId = (await admin.from("product_variants").select("id").limit(1).single()).data!.id;
    inventoryItemId = (await admin.from("inventory_items").select("id").eq("product_variant_id", variantId).single()).data!.id;
    customerId = (await admin.from("customers").insert({ first_name: `${RUN} Cliente` }).select("id").single()).data!.id;
  });

  afterAll(async () => {
    if (paths.length) await admin.storage.from(BUCKET).remove(paths);
    if (movementIds.length) await admin.from("inventory_movements").delete().in("id", movementIds);
    if (productionIds.length) await admin.from("production_orders").delete().in("id", productionIds);
    await admin.from("order_deletions").delete().like("human_code", "%").in("order_id", orderIds);
    await cleanupFixtures(admin, "delete-order", { orderIds, customerIds: [customerId] });
  });

  describe("pedido elegible", () => {
    it("classify: deletable, sin bloqueos", async () => {
      const id = await makeOrder();
      expect(await classify(id)).toMatchObject({
        deletable: true, block_message: null, payments_count: 0, movements_count: 0, production_orders_count: 0, from_checkout: false, status: "pending",
      });
    });

    it("el owner lo elimina: desaparece el pedido con sus ítems, historial y reservas activas (que NO bloquean)", async () => {
      const id = await makeOrder();
      await admin.from("inventory_reservations").insert({ inventory_item_id: inventoryItemId, location_id: locationId, order_id: id, quantity: 1, status: "active" });
      expect(await count("order_items", "order_id", id)).toBe(2);
      expect(await count("order_status_history", "order_id", id)).toBeGreaterThan(0);

      const { data, error } = await del(id);
      expect(error).toBeNull();
      expect((data as { human_code: string }[])[0].human_code).toMatch(/^PED-/);

      expect(await exists(id)).toBe(false);
      for (const [table, col] of [["order_items", "order_id"], ["order_status_history", "order_id"], ["inventory_reservations", "order_id"]]) {
        expect(await count(table, col, id)).toBe(0);
      }
    });

    it("NO borra el cliente ni el producto/variante del pedido", async () => {
      const id = await makeOrder();
      await del(id);
      expect((await admin.from("customers").select("id").eq("id", customerId).maybeSingle()).data).not.toBeNull();
      expect((await admin.from("product_variants").select("id").eq("id", variantId).maybeSingle()).data).not.toBeNull();
    });

    it("deja registro en order_deletions (quién, cuándo, motivo, importe) y sólo el owner lo lee", async () => {
      const id = await makeOrder();
      const { data: before } = await admin.from("orders").select("human_code,total,created_at").eq("id", id).single();
      await del(id, "  cargado dos veces  ");

      const { data: log } = await admin.from("order_deletions").select("*").eq("order_id", id).single();
      expect(log).toMatchObject({
        human_code: before!.human_code, item_count: 2, status: "pending", reason: "cargado dos veces",
        deleted_by: ids.owner, customer_id: customerId, business_unit_id: unitId,
      });
      expect(Number(log!.total)).toBe(Number(before!.total));
      expect(new Date(log!.order_created_at).getTime()).toBe(new Date(before!.created_at).getTime());

      expect(((await clients.owner.from("order_deletions").select("id").eq("order_id", id)).data ?? []).length).toBe(1);
      expect(((await clients.operations.from("order_deletions").select("id").eq("order_id", id)).data ?? []).length).toBe(0);
      expect(((await clients.viewer.from("order_deletions").select("id").eq("order_id", id)).data ?? []).length).toBe(0);
    });

    it("un pedido cancelado SIN consecuencias también es elegible", async () => {
      const id = await makeOrder();
      await admin.from("orders").update({ status: "cancelled" }).eq("id", id);
      expect(await classify(id)).toMatchObject({ deletable: true });
      expect((await del(id)).error).toBeNull();
      expect(await exists(id)).toBe(false);
    });

    it("el código de un pedido borrado NO se reutiliza (queda un hueco en la numeración)", async () => {
      const first = await makeOrder();
      const { data: a } = await admin.from("orders").select("human_code").eq("id", first).single();
      await del(first);
      const second = await makeOrder();
      const { data: b } = await admin.from("orders").select("human_code").eq("id", second).single();
      expect(Number(b!.human_code.split("-")[1])).toBeGreaterThan(Number(a!.human_code.split("-")[1]));
    });

    it("eliminar dos veces: la segunda dice que el pedido no existe", async () => {
      const id = await makeOrder();
      await del(id);
      expect((await del(id)).error?.message).toMatch(/no existe/i);
    });
  });

  describe("pedido NO elegible: no se borra nada", () => {
    const expectIntact = async (id: string, message: RegExp, extra: () => Promise<void> = async () => {}) => {
      const check = await classify(id);
      expect(check.deletable).toBe(false);
      expect(check.block_message).toMatch(message);
      const result = await del(id);
      expect(result.error?.message).toMatch(message);
      expect(await exists(id)).toBe(true);
      expect(await count("order_items", "order_id", id)).toBe(2);
      expect(await count("order_deletions", "order_id", id)).toBe(0);
      await extra();
    };

    it("con pagos: bloquea, conserva los pagos, y ofrece cancelar", async () => {
      const id = await makeOrder();
      await addPayment(id);
      await expectIntact(id, /ya tiene movimientos asociados y no puede eliminarse\. Podés cancelarlo\./, async () => {
        expect(await count("payments", "order_id", id)).toBe(1);
      });
    });

    it("con movimientos de stock del pedido: bloquea", async () => {
      const id = await makeOrder();
      const { data: m } = await admin.from("inventory_movements")
        .insert({ inventory_item_id: inventoryItemId, location_id: locationId, movement_type: "sale", quantity: -1, reference_table: "orders", reference_id: id })
        .select("id").single();
      movementIds.push(m!.id);
      expect((await classify(id)).movements_count).toBe(1);
      await expectIntact(id, /movimientos asociados/);
      expect((await admin.from("inventory_movements").select("id").eq("id", m!.id).maybeSingle()).data).not.toBeNull();
    });

    it("con orden de producción: bloquea y la orden de producción conserva su vínculo", async () => {
      const id = await makeOrder();
      const { data: p } = await admin.from("production_orders")
        .insert({ order_id: id, product_variant_id: variantId, location_id: locationId, quantity: 1 }).select("id").single();
      productionIds.push(p!.id);
      await expectIntact(id, /movimientos asociados/, async () => {
        expect((await admin.from("production_orders").select("order_id").eq("id", p!.id).single()).data!.order_id).toBe(id);
      });
    });

    it("entregado: bloquea y NO sugiere cancelar (ya no se puede)", async () => {
      const id = await makeOrder();
      await admin.from("orders").update({ status: "delivered" }).eq("id", id);
      await expectIntact(id, /^Este pedido ya fue entregado y no puede eliminarse\.$/);
    });

    it("solicitud del checkout mayorista: bloquea", async () => {
      const id = await makeOrder({ checkout: true });
      expect((await classify(id)).from_checkout).toBe(true);
      await expectIntact(id, /solicitud del checkout mayorista y no puede eliminarse\. Podés cancelarlo\./);
    });

    it("cancelado con pagos: bloquea y no sugiere cancelar", async () => {
      const id = await makeOrder();
      await addPayment(id);
      await admin.from("orders").update({ status: "cancelled" }).eq("id", id);
      await expectIntact(id, /^Este pedido ya tiene movimientos asociados y no puede eliminarse\.$/);
    });
  });

  describe("permisos y vías de borrado", () => {
    it("operations y viewer NO pueden eliminar (RPC)", async () => {
      const id = await makeOrder();
      for (const role of ["operations", "viewer"] as Role[]) {
        expect((await del(id, null, role)).error?.message).toMatch(/Sólo la administradora/);
      }
      expect(await exists(id)).toBe(true);
    });

    it("un DELETE directo sobre `orders` por la API NO borra nada (ni owner ni operations) y los pagos quedan", async () => {
      const id = await makeOrder();
      await addPayment(id);
      for (const role of ["owner", "operations", "viewer"] as Role[]) {
        await clients[role].from("orders").delete().eq("id", id);
        expect(await exists(id)).toBe(true);
      }
      expect(await count("payments", "order_id", id)).toBe(1);
    });

    it("no regresión: operations SIGUE pudiendo crear y actualizar pedidos", async () => {
      const id = await makeOrder(); // insert vía create_order con la sesión de operations
      const { error } = await clients.operations.from("orders").update({ notes: "editado por operations" }).eq("id", id);
      expect(error).toBeNull();
      expect((await admin.from("orders").select("notes").eq("id", id).single()).data!.notes).toBe("editado por operations");
      expect((await clients.operations.rpc("set_order_status", { p_order_id: id, p_new_status: "cancelled" })).error).toBeNull();
    });

    it("el motivo de más de 300 caracteres se rechaza", async () => {
      const id = await makeOrder();
      const r = await del(id, "x".repeat(301));
      expect(r.error).not.toBeNull();
      expect(await exists(id)).toBe(true);
    });
  });

  describe("concurrencia", () => {
    it("un pago que llega mientras se elimina: nunca queda un pedido borrado con pago perdido ni ambos éxitos", async () => {
      for (let i = 0; i < 6; i++) {
        const id = await makeOrder();
        const [deletion, payment] = await Promise.all([
          del(id),
          admin.from("payments").insert({ order_id: id, amount: 10, paid_at: new Date().toISOString() }),
        ]);
        const deleted = deletion.error === null;
        const paid = payment.error === null;
        expect(deleted && paid).toBe(false); // nunca los dos
        expect(deleted || paid).toBe(true); // siempre uno
        expect(await exists(id)).toBe(!deleted);
        expect(await count("payments", "order_id", id)).toBe(paid ? 1 : 0);
      }
    });
  });

  describe("server action deleteOrder", () => {
    it("owner: elimina, borra los adjuntos de Storage DESPUÉS del commit y devuelve {}", async () => {
      const id = await makeOrder();
      const path = `${id}/adjunto-${RUN}.pdf`;
      paths.push(path);
      await admin.storage.from(BUCKET).upload(path, Buffer.from("%PDF-1.4 x"), { contentType: "application/pdf" });
      await admin.from("order_attachments").insert({ order_id: id, storage_path: path, kind: "wholesale_request_pdf" });

      expect(await deleteOrder(id, "prueba")).toEqual({});
      expect(await exists(id)).toBe(false);
      expect((await admin.storage.from(BUCKET).download(path)).data).toBeNull();
    });

    it("si Storage falla el pedido igual se elimina, sin error al usuario, y queda un log estructurado", async () => {
      const id = await makeOrder();
      const path = `${id}/adjunto-falla-${RUN}.pdf`;
      await admin.from("order_attachments").insert({ order_id: id, storage_path: path, kind: "wholesale_request_pdf" });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const failing = {
        rpc: (fn: string, args: Record<string, unknown>) => clients.owner.rpc(fn, args),
        storage: { from: () => ({ remove: async () => ({ data: null, error: { message: "storage caído" } }) }) },
      } as unknown as SupabaseClient;
      currentClient = failing;

      expect(await deleteOrder(id)).toEqual({});
      expect(await exists(id)).toBe(false);
      const events = errorSpy.mock.calls.map((c) => c[0]).filter((l): l is string => typeof l === "string").map((l) => JSON.parse(l));
      expect(events).toContainEqual(expect.objectContaining({ event: "order_delete_storage_cleanup_failed", orderId: id, pathCount: 1 }));
      errorSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it("operations: sin permiso, nada se elimina", async () => {
      const id = await makeOrder();
      as("operations");
      expect(await deleteOrder(id)).toEqual({ error: "Sólo la administradora puede eliminar pedidos." });
      expect(await exists(id)).toBe(true);
    });

    it("pedido con pagos: devuelve el mensaje claro de la base y no borra", async () => {
      const id = await makeOrder();
      await addPayment(id);
      const result = await deleteOrder(id);
      expect(result.error).toMatch(/ya tiene movimientos asociados y no puede eliminarse/);
      expect(await exists(id)).toBe(true);
    });

    it("id inválido y motivo demasiado largo se rechazan antes de tocar la base", async () => {
      expect(await deleteOrder("no-es-uuid")).toEqual({ error: "Pedido inválido." });
      expect(await deleteOrder("00000000-0000-4000-8000-000000000000", "x".repeat(301))).toEqual({ error: "El motivo no puede superar los 300 caracteres." });
    });
  });
});
