import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupFixtures } from "../../../tests/support/fixture-cleanup";

// Capa de datos de la pantalla /reportes contra Supabase LOCAL real, con la sesión de cada rol:
// buscador de modelos (acción del servidor), resolución de la selección y primera fecha de actividad.
// Se mockean sólo las costuras de Next (sesión y cliente de servidor), como delete-order.integration.test.ts.

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
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const { searchModels } = await import("./actions");
const { getModelsByIds, getFirstActivityDate } = await import("@/lib/reports");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";
const EMAILS: Record<Role, string> = {
  owner: "owner-test@pottery.local",
  operations: "operations-test@pottery.local",
  viewer: "viewer-test@pottery.local",
};
const RUN = `ZZUI${Date.now().toString(36)}`;
const ART = (iso: string) => `${iso}-03:00`;

describe("/reportes: buscador de modelos, selección y primera actividad (local)", { timeout: 60000 }, () => {
  let admin: SupabaseClient;
  const clients = {} as Record<Role, SupabaseClient>;
  const ids = {} as Record<Role, string>;
  let categoryId: string;
  let customerId: string;
  const orderIds: string[] = [];
  const productIds: string[] = [];
  const names = { a: `${RUN} Taza Amalia`, b: `${RUN} Taza Lucía`, inactive: `${RUN} Taza Vieja`, pct: `${RUN} 50% Bahía`, under: `${RUN} A_B Plato` };
  const id: Record<string, string> = {};

  const as = (role: Role) => {
    currentRole = role;
    currentClient = clients[role];
    currentUserId = ids[role];
  };
  beforeEach(() => as("owner"));

  async function signIn(role: Role) {
    const { data: users } = await admin.auth.admin.listUsers();
    let userId = users.users.find((u) => u.email === EMAILS[role])?.id;
    if (!userId) {
      const { data: created, error } = await admin.auth.admin.createUser({ email: EMAILS[role], password: PASSWORD, email_confirm: true });
      if (error) throw error;
      userId = created.user!.id;
      await admin.from("user_roles").insert({ user_id: userId, role });
    }
    const c = createClient(SUPABASE_URL, ANON_KEY);
    const { error } = await c.auth.signInWithPassword({ email: EMAILS[role], password: PASSWORD });
    if (error) throw error;
    clients[role] = c;
    ids[role] = userId;
  }

  async function makeProduct(key: keyof typeof names, over: Record<string, unknown> = {}) {
    const { data, error } = await admin.from("products").insert({ name: names[key], is_active: true, category_id: categoryId, ...over }).select("id").single();
    if (error) throw error;
    productIds.push(data.id);
    id[key] = data.id;
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    for (const role of ["owner", "operations", "viewer"] as Role[]) await signIn(role);
    categoryId = (await admin.from("product_categories").insert({ code: `zz-${RUN.toLowerCase()}`, name: `${RUN} Tazas` }).select("id").single()).data!.id;
    customerId = (await admin.from("customers").insert({ first_name: `${RUN} Cliente` }).select("id").single()).data!.id;
    await makeProduct("a");
    await makeProduct("b");
    await makeProduct("inactive", { is_active: false });
    await makeProduct("pct");
    await makeProduct("under");
  });

  afterAll(async () => {
    await cleanupFixtures(admin, "reports-ui", { orderIds, productIds, customerIds: [customerId], categoryIds: [categoryId] });
  });

  describe("buscador de modelos (acción del servidor)", () => {
    it("con menos de 2 caracteres no busca (devuelve vacío sin tocar la base)", async () => {
      expect(await searchModels("")).toEqual({ models: [] });
      expect(await searchModels("a")).toEqual({ models: [] });
      expect(await searchModels("  a ")).toEqual({ models: [] });
    });

    it("encuentra por nombre sin importar mayúsculas, ordenado, con su categoría; incluye inactivos (para mirar historia)", async () => {
      const { models, error } = await searchModels(`${RUN.toLowerCase()} taza`);
      expect(error).toBeUndefined();
      expect(models.map((m) => m.name)).toEqual([names.a, names.b, names.inactive]); // por nombre
      expect(models.every((m) => m.category === `${RUN} Tazas`)).toBe(true);
      expect(models.find((m) => m.id === id.inactive)).toBeDefined();
    });

    it("los comodines de LIKE se buscan LITERALMENTE ('%' y '_' no matchean todo)", async () => {
      const pct = await searchModels(`${RUN} 50%`);
      expect(pct.models.map((m) => m.id)).toEqual([id.pct]);
      const under = await searchModels(`${RUN} A_B`);
      expect(under.models.map((m) => m.id)).toEqual([id.under]);
      // Un '%' suelto o un '_' suelto no devuelven "todo el catálogo".
      const wild = await searchModels("%%");
      expect(wild.models.every((m) => m.name.includes("%"))).toBe(true);
    });

    it("devuelve a lo sumo 20 resultados (aunque haya más coincidencias)", async () => {
      const { data, error } = await admin.from("products").insert(Array.from({ length: 23 }, (_, i) => ({ name: `${RUN} Lote ${String(i).padStart(2, "0")}`, is_active: true })) ).select("id");
      if (error) throw error;
      productIds.push(...data!.map((p) => p.id as string));
      const { models } = await searchModels(`${RUN} Lote`);
      expect(models).toHaveLength(20);
      expect(models[0].name).toBe(`${RUN} Lote 00`);
      expect(models[19].name).toBe(`${RUN} Lote 19`);
    });

    it("una consulta absurdamente larga se descarta; owner y operations pueden, viewer no", async () => {
      expect(await searchModels("x".repeat(81))).toEqual({ models: [] });
      as("operations");
      expect((await searchModels(`${RUN} Taza`)).models.length).toBeGreaterThan(0);
      as("viewer");
      expect(await searchModels(`${RUN} Taza`)).toEqual({ models: [], error: "No tenés permiso para ver reportes." });
    });
  });

  describe("selección de modelos", () => {
    it("getModelsByIds respeta el orden pedido y descarta ids que no existen", async () => {
      const models = await getModelsByIds([id.b, "00000000-0000-4000-8000-0000000000ff", id.a]);
      expect(models.map((m) => m.id)).toEqual([id.b, id.a]);
      expect(await getModelsByIds([])).toEqual([]);
    });
  });

  describe("primera fecha de actividad (para que 'todo el histórico' no genere cientos de meses en 0)", () => {
    it("toma el MÍNIMO entre pedidos no cancelados (sale_date), pagos y otros ingresos (día en hora Argentina); ignora cancelados", async () => {
      const mk = async (sale: string, status: string, payAt?: string) => {
        const { data: order } = await admin.from("orders").insert({
          business_unit_id: (await admin.from("business_units").select("id").eq("code", "retail").single()).data!.id,
          customer_id: customerId, sale_date: sale, status,
        }).select("id").single();
        orderIds.push(order!.id);
        await admin.from("order_items").insert({ order_id: order!.id, custom_name: "x", quantity: 1, unit_price: 10 });
        if (payAt) await admin.from("payments").insert({ order_id: order!.id, amount: 5, paid_at: payAt });
      };
      // 1995 está antes de cualquier otra suite. Un pedido CANCELADO aún más viejo no cuenta.
      await mk("1994-02-02", "cancelled");
      await mk("1995-06-15", "delivered");
      expect(await getFirstActivityDate()).toBe("1995-06-15");

      // Un pago del 14-jun a las 23:30 ART (02:30Z del 15) cae en el día 14 argentino: gana por un día.
      await mk("1995-08-01", "delivered", ART("1995-06-14T23:30:00"));
      expect(await getFirstActivityDate()).toBe("1995-06-14");
    });
  });
});
