import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupFixtures } from "../../../../tests/support/fixture-cleanup";

// generateWholesaleDocumentForOrder (backoffice) contra Supabase LOCAL real,
// con la sesión de cada rol. Se mockean sólo las costuras de Next: la
// sesión (requireUser/isOwner/hasRole), el cliente de servidor (que aquí
// es un supabase-js autenticado como el rol de turno) y revalidatePath.

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

const { generateWholesaleDocumentForOrder } = await import("./document-actions");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "order-attachments";

const USERS: Record<Role, { email: string }> = {
  owner: { email: "owner-test@pottery.local" },
  operations: { email: "operations-test@pottery.local" },
  viewer: { email: "viewer-test@pottery.local" },
};
const PASSWORD = "test-password-123";

const BUYER = {
  first_name: "Fixture", last_name: "Action", company_name: "Fixture PDF", cuit: null, instagram: null, website: null,
  city: "Rosario", province: "Santa Fe", address: null, postal_code: null, whatsapp: "5493410000001", email: null,
};
const TERMS = { min_order_amount: null, min_total_units: null, lead_time_min_days: 15, lead_time_max_days: 25, payment_terms: "50% seña", shipping_terms: null };

describe("generateWholesaleDocumentForOrder (backoffice, local)", () => {
  let admin: SupabaseClient;
  const clients = {} as Record<Role, SupabaseClient>;
  const ids = {} as Record<Role, string>;
  let unitId: string;
  let variantId: string;
  const orderIds: string[] = [];
  const paths: string[] = [];

  async function signIn(role: Role) {
    const email = USERS[role].email;
    const { data: users } = await admin.auth.admin.listUsers();
    let id = users.users.find((u) => u.email === email)?.id;
    if (!id) {
      const { data: created, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error) throw error;
      id = created.user!.id;
      await admin.from("user_roles").insert({ user_id: id, role });
    }
    const client = createClient(SUPABASE_URL, ANON_KEY);
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw error;
    clients[role] = client;
    ids[role] = id;
  }

  async function makeOrder(kind: "web" | "manual") {
    const { data, error } = await admin
      .from("orders")
      .insert({ business_unit_id: unitId, operation_type: "order", ...(kind === "web" ? { wholesale_buyer_snapshot: BUYER, wholesale_terms_snapshot: TERMS } : {}) })
      .select("id,human_code")
      .single();
    if (error) throw error;
    orderIds.push(data.id);
    await admin.from("order_items").insert({ order_id: data.id, product_variant_id: variantId, quantity: 3, unit_price: 250 });
    const path = `${data.id}/${data.human_code}.pdf`;
    paths.push(path);
    return { orderId: data.id as string, humanCode: data.human_code as string, path };
  }

  const rows = async (orderId: string) =>
    (await admin.from("order_attachments").select("id,storage_path,uploaded_by").eq("order_id", orderId).eq("kind", "wholesale_request_pdf")).data ?? [];
  const head = async (path: string) => {
    const { data } = await admin.storage.from(BUCKET).download(path);
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  };
  const as = (role: Role) => {
    currentRole = role;
    currentClient = clients[role];
    currentUserId = ids[role];
  };

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    for (const role of ["owner", "operations", "viewer"] as Role[]) await signIn(role);
    const { data: unit } = await admin.from("business_units").select("id").eq("code", "wholesale").single();
    unitId = unit!.id;
    const { data: v } = await admin.from("product_variants").select("id").limit(1).single();
    variantId = v!.id;
  }, 40000);

  beforeEach(() => as("owner"));

  afterAll(async () => {
    if (paths.length) await admin.storage.from(BUCKET).remove(paths);
    await cleanupFixtures(admin, "document-actions", { orderIds });
  }, 30000);

  describe("permisos", () => {
    it("un viewer NO puede generar ni regenerar: no queda ni archivo ni fila", async () => {
      const o = await makeOrder("web");
      as("viewer");
      const result = await generateWholesaleDocumentForOrder(o.orderId);
      expect(result.error).toMatch(/permiso/i);
      expect(await rows(o.orderId)).toHaveLength(0);
      expect(await head(o.path)).toBeNull();
    });

    it("un usuario de operations SÍ puede (y queda como uploaded_by)", async () => {
      const o = await makeOrder("web");
      as("operations");
      expect(await generateWholesaleDocumentForOrder(o.orderId)).toEqual({});
      const [row] = await rows(o.orderId);
      expect(row.storage_path).toBe(o.path);
      expect(row.uploaded_by).toBe(ids.operations);
    });

    it("el owner SÍ puede", async () => {
      const o = await makeOrder("web");
      expect(await generateWholesaleDocumentForOrder(o.orderId)).toEqual({});
      expect(await rows(o.orderId)).toHaveLength(1);
    });
  });

  describe("generación y regeneración", () => {
    it("genera un PDF REAL (%PDF) en la ruta determinística con una única fila", async () => {
      const o = await makeOrder("web");
      expect(await generateWholesaleDocumentForOrder(o.orderId)).toEqual({});
      const file = await head(o.path);
      expect(file!.subarray(0, 5).toString()).toBe("%PDF-");
      expect(file!.length).toBeGreaterThan(1000);
      expect(await rows(o.orderId)).toHaveLength(1);
    });

    it("regenerar varias veces (owner y operations alternando): una fila, misma ruta, mismo id de fila", async () => {
      const o = await makeOrder("web");
      as("operations");
      await generateWholesaleDocumentForOrder(o.orderId);
      const [first] = await rows(o.orderId);
      for (const role of ["owner", "operations", "owner"] as Role[]) {
        as(role);
        expect(await generateWholesaleDocumentForOrder(o.orderId)).toEqual({});
      }
      const after = await rows(o.orderId);
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(first.id);
      expect(after[0].storage_path).toBe(o.path);
    });

    it("ARCHIVO HUÉRFANO en Storage (antes fallaba por upsert:false): se recupera", async () => {
      const o = await makeOrder("web");
      await admin.storage.from(BUCKET).upload(o.path, Buffer.from("basura previa"), { contentType: "application/pdf" });
      expect(await generateWholesaleDocumentForOrder(o.orderId)).toEqual({});
      expect((await head(o.path))!.subarray(0, 5).toString()).toBe("%PDF-"); // reemplazado por el PDF real
      expect(await rows(o.orderId)).toHaveLength(1);
    });

    it("FILA HUÉRFANA (fila sin archivo): recrea el archivo sin crear una segunda fila", async () => {
      const o = await makeOrder("web");
      await admin.from("order_attachments").insert({ order_id: o.orderId, storage_path: o.path, kind: "wholesale_request_pdf" });
      expect(await generateWholesaleDocumentForOrder(o.orderId)).toEqual({});
      expect(await head(o.path)).not.toBeNull();
      expect(await rows(o.orderId)).toHaveLength(1);
    });

    it("no modifica el pedido, sus pagos, sus items ni su historial", async () => {
      const o = await makeOrder("web");
      await admin.from("payments").insert({ order_id: o.orderId, amount: 100, paid_at: new Date().toISOString() });
      const snapshot = async () => ({
        order: (await admin.from("orders").select("status,total,subtotal,discount_total,wholesale_buyer_snapshot,wholesale_terms_snapshot").eq("id", o.orderId).single()).data,
        payments: (await admin.from("payments").select("id,amount").eq("order_id", o.orderId)).data,
        items: (await admin.from("order_items").select("id,quantity,unit_price").eq("order_id", o.orderId)).data,
        history: (await admin.from("order_status_history").select("id").eq("order_id", o.orderId)).data,
      });
      const before = await snapshot();
      await generateWholesaleDocumentForOrder(o.orderId);
      await generateWholesaleDocumentForOrder(o.orderId);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("pedidos que no son del checkout", () => {
    it("un pedido MANUAL en la unidad Mayorista responde con un mensaje neutral y no crea nada", async () => {
      const o = await makeOrder("manual");
      const result = await generateWholesaleDocumentForOrder(o.orderId);
      expect(result.error).toMatch(/no proviene del checkout mayorista/i);
      expect(result.error).not.toMatch(/fall/i);
      expect(await rows(o.orderId)).toHaveLength(0);
      expect(await head(o.path)).toBeNull();
    });

    it("un pedido inexistente devuelve un error claro", async () => {
      const result = await generateWholesaleDocumentForOrder("00000000-0000-4000-8000-000000000000");
      expect(result.error).toMatch(/No encontramos el pedido/);
    });
  });
});
