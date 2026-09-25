import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// getWholesaleCatalog() usa createClient() de server (cookies); acá se
// prueba fetchWholesaleCatalog() — el código REAL de producción, no una
// réplica — con clientes de cada rol.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("no debería usarse: el test inyecta el cliente");
  },
}));
const { fetchWholesaleCatalog } = await import("./wholesale");

// Regresión del bug "productos deshabilitados para mayorista siguen
// apareciendo en /mayorista" (Adornitos, Hornitos). Causa: el RLS de
// `anon` exige wholesale_product_rules.is_public, pero un usuario
// `authenticated` (Juli con sesión iniciada) tiene products USING (true),
// y lib/wholesale.ts sólo filtraba is_active. Por eso el visitante
// anónimo NO veía el producto y Juli SÍ.
//
// Corre EXCLUSIVAMENTE contra Supabase LOCAL.

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

const OWNER_EMAIL = "owner-test@pottery.local";
const OWNER_PASSWORD = "test-password-123";
// Empieza con "0" para ordenar antes que cualquier otro producto: sin el
// filtro de is_public, el catálogo de una usuaria autenticada trae TODOS
// los productos activos y PostgREST lo corta en 1.000 filas por nombre —
// si los fixtures quedaran más allá de ese corte, el test no vería el bug.
const PREFIX = "0 Visibilidad Fixture";

describe.skipIf(!hasCredentials)("visibilidad en /mayorista (local)", () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let owner: SupabaseClient;
  let wholesaleListId: string;
  let customerId: string;
  let orderId: string;
  const ids: Record<string, string> = {};

  async function makeProduct(
    key: string,
    opts: { isActive?: boolean; rules?: boolean | null; price?: number | null; variantActive?: boolean }
  ) {
    const { data: product, error } = await admin
      .from("products")
      .insert({ name: `${PREFIX} ${key}`, is_active: opts.isActive ?? true })
      .select("id")
      .single();
    if (error) throw error;
    ids[key] = product.id;
    const { data: variant } = await admin.from("product_variants").select("id").eq("product_id", product.id).single();
    if (opts.variantActive === false) await admin.from("product_variants").update({ is_active: false }).eq("id", variant!.id);
    if (opts.price != null) {
      await admin
        .from("price_list_items")
        .insert({ price_list_id: wholesaleListId, product_variant_id: variant!.id, unit_price: opts.price });
    }
    if (opts.rules !== null && opts.rules !== undefined) {
      await admin.from("wholesale_product_rules").insert({ product_id: product.id, is_public: opts.rules, min_quantity: 1 });
    }
    return variant!.id as string;
  }

  const namesFor = async (client: SupabaseClient) =>
    (await fetchWholesaleCatalog(client)).products.map((p) => p.name).filter((n) => n.startsWith(PREFIX));

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    anon = createClient(SUPABASE_URL!, ANON_KEY!);
    owner = createClient(SUPABASE_URL!, ANON_KEY!);

    const { data: users } = await admin.auth.admin.listUsers();
    let ownerId = users.users.find((u) => u.email === OWNER_EMAIL)?.id;
    if (!ownerId) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      ownerId = created.user!.id;
      await admin.from("user_roles").insert({ user_id: ownerId, role: "owner" });
    }
    const { error: signInErr } = await owner.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    if (signInErr) throw signInErr;

    const { data: list } = await admin.from("price_lists").select("id").eq("code", "wholesale").single();
    wholesaleListId = list!.id;

    await makeProduct("visible", { rules: true, price: 5000 });
    await makeProduct("oculto", { rules: false, price: 5000 }); // el caso Adornitos/Hornitos
    await makeProduct("sin-reglas", { rules: null, price: 5000 });
    await makeProduct("inactivo", { isActive: false, rules: true, price: 5000 });
    await makeProduct("variante-inactiva", { rules: true, price: 5000, variantActive: false });
    await makeProduct("sin-precio", { rules: true, price: null });
    await makeProduct("sin-stock", { rules: true, price: 5000 }); // ningún inventory_movement = stock 0
    const hiddenVariantId = await makeProduct("historico", { rules: true, price: 5000 });

    const { data: unit } = await admin.from("business_units").select("id").eq("code", "wholesale").single();
    const { data: customer } = await admin.from("customers").insert({ first_name: `${PREFIX} Cliente` }).select("id").single();
    customerId = customer!.id;
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: unit!.id, customer_id: customerId, operation_type: "order", status: "delivered", total: 0 })
      .select("id")
      .single();
    orderId = order!.id;
    await admin
      .from("order_items")
      .insert({ order_id: orderId, product_variant_id: hiddenVariantId, quantity: 2, unit_price: 5000 });
  }, 30000);

  afterAll(async () => {
    await admin.from("orders").delete().eq("id", orderId); // cascade order_items
    await admin.from("customers").delete().eq("id", customerId);
    await admin.from("products").delete().ilike("name", `${PREFIX}%`); // cascade variantes/precios/reglas
  }, 30000);

  for (const [label, get] of [
    ["visitante anónimo", () => anon],
    ["usuaria autenticada (Juli con sesión)", () => owner],
  ] as const) {
    describe(label, () => {
      it("producto activo + habilitado para mayorista + con precio → aparece", async () => {
        expect(await namesFor(get())).toContain(`${PREFIX} visible`);
      });

      it("producto activo + deshabilitado para mayorista (is_public=false) → NO aparece", async () => {
        expect(await namesFor(get())).not.toContain(`${PREFIX} oculto`);
      });

      it("producto activo sin fila en wholesale_product_rules (nunca habilitado) → NO aparece", async () => {
        expect(await namesFor(get())).not.toContain(`${PREFIX} sin-reglas`);
      });

      it("producto inactivo → NO aparece, aunque esté habilitado y con precio", async () => {
        expect(await namesFor(get())).not.toContain(`${PREFIX} inactivo`);
      });

      it("producto cuya única variante está inactiva → NO aparece", async () => {
        expect(await namesFor(get())).not.toContain(`${PREFIX} variante-inactiva`);
      });

      it("producto sin precio mayorista → NO aparece", async () => {
        expect(await namesFor(get())).not.toContain(`${PREFIX} sin-precio`);
      });

      it("producto con stock 0 → SÍ aparece (el stock no decide la visibilidad)", async () => {
        expect(await namesFor(get())).toContain(`${PREFIX} sin-stock`);
      });

      it("ambos roles ven exactamente el mismo conjunto de fixtures", async () => {
        expect((await namesFor(owner)).sort()).toEqual((await namesFor(anon)).sort());
      });
    });
  }

  describe("ocultar un producto no lo saca del backoffice ni rompe el histórico", () => {
    it("el producto oculto sigue disponible para la usuaria autenticada (backoffice)", async () => {
      const { data } = await owner.from("products").select("id,name,is_active").eq("id", ids["oculto"]);
      expect(data).toHaveLength(1);
      expect(data![0].is_active).toBe(true);
    });

    it("ocultar un producto con pedidos históricos no rompe el pedido", async () => {
      await admin.from("wholesale_product_rules").update({ is_public: false }).eq("product_id", ids["historico"]);

      expect(await namesFor(owner)).not.toContain(`${PREFIX} historico`);

      const { data: items } = await owner
        .from("order_items")
        .select("quantity,unit_price,product_variants(name,products(name))")
        .eq("order_id", orderId);
      expect(items).toHaveLength(1);
      expect(items![0].quantity).toBe(2);
      const product = (items![0].product_variants as unknown as { products: { name: string } }).products;
      expect(product.name).toBe(`${PREFIX} historico`);
    });

    it("volver a habilitar el producto lo hace reaparecer (nada se borró)", async () => {
      await admin.from("wholesale_product_rules").update({ is_public: true }).eq("product_id", ids["historico"]);
      expect(await namesFor(owner)).toContain(`${PREFIX} historico`);
    });
  });
});
