import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupFixtures } from "../tests/support/fixture-cleanup";

// Se prueba el código REAL (fetchWholesaleCatalog + las RPC/RLS de la
// migración 20260925090000) con clientes de cada rol. createClient() de
// server usa cookies, así que se inyecta el cliente.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("no debería usarse: el test inyecta el cliente");
  },
}));
const { fetchWholesaleCatalog } = await import("./wholesale");
const { fetchFeaturedSectionsAdmin } = await import("./wholesale-featured");

// El entorno (Supabase LOCAL) lo valida el gate de test:integration.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const OWNER = { email: "owner-test@pottery.local", password: "test-password-123", role: "owner" };
const OPS = { email: "operations-test@pottery.local", password: "test-password-123", role: "operations" };

// Empieza con "0" para ordenar antes que cualquier otro producto.
const PREFIX = "0 Destacadas Fixture";
const PAST = "2020-01-01T00:00:00-03:00";
const PAST_END = "2020-12-31T23:59:59-03:00";
const FUTURE = "2099-01-01T00:00:00-03:00";
const FAR_FUTURE = "2099-12-31T23:59:59-03:00";

describe("secciones destacadas mayoristas (local)", () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let owner: SupabaseClient;
  let ops: SupabaseClient;
  let wholesaleListId: string;
  const productIds: Record<string, string> = {};
  const sectionIds: string[] = [];

  async function makeProduct(key: string, opts: { isPublic: boolean; price: number | null }) {
    const { data: product, error } = await admin
      .from("products")
      .insert({ name: `${PREFIX} ${key}`, is_active: true })
      .select("id")
      .single();
    if (error) throw error;
    productIds[key] = product.id;
    const { data: variant } = await admin.from("product_variants").select("id").eq("product_id", product.id).single();
    if (opts.price != null) {
      await admin
        .from("price_list_items")
        .insert({ price_list_id: wholesaleListId, product_variant_id: variant!.id, unit_price: opts.price });
    }
    await admin.from("wholesale_product_rules").insert({ product_id: product.id, is_public: opts.isPublic, min_quantity: 1 });
  }

  async function signInAs(user: typeof OWNER) {
    const { data: users } = await admin.auth.admin.listUsers();
    if (!users.users.find((u) => u.email === user.email)) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
      });
      if (error) throw error;
      await admin.from("user_roles").insert({ user_id: created.user!.id, role: user.role });
    }
    const client = createClient(SUPABASE_URL, ANON_KEY);
    const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
    if (error) throw error;
    return client;
  }

  /** Crea una sección vía la RPC real, como owner. */
  async function saveSection(opts: {
    id?: string | null;
    title: string;
    isActive?: boolean;
    startsAt?: string | null;
    endsAt?: string | null;
    products?: string[];
    client?: SupabaseClient;
  }) {
    const slug = `${opts.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + `-${Math.random().toString(36).slice(2, 7)}`;
    const { data, error } = await (opts.client ?? owner).rpc("save_wholesale_featured_section", {
      p_id: opts.id ?? null,
      p_title: opts.title,
      p_slug: slug,
      p_description: null,
      p_is_active: opts.isActive ?? true,
      p_starts_at: opts.startsAt ?? null,
      p_ends_at: opts.endsAt ?? null,
      p_product_ids: (opts.products ?? []).map((k) => productIds[k]),
    });
    if (!error && data && !opts.id) sectionIds.push(data as string);
    return { id: data as string | null, error };
  }

  const featuredFor = async (client: SupabaseClient) =>
    (await fetchWholesaleCatalog(client)).featuredSections.filter((s) => sectionIds.includes(s.id));
  const namesOf = (section: { products: { name: string }[] }) => section.products.map((p) => p.name.replace(`${PREFIX} `, ""));

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    anon = createClient(SUPABASE_URL, ANON_KEY);
    owner = await signInAs(OWNER);
    ops = await signInAs(OPS);

    const { data: list } = await admin.from("price_lists").select("id").eq("code", "wholesale").single();
    wholesaleListId = list!.id;

    await makeProduct("A", { isPublic: true, price: 1000 });
    await makeProduct("B", { isPublic: true, price: 2000 });
    await makeProduct("C", { isPublic: true, price: 3000 });
    await makeProduct("oculto", { isPublic: false, price: 4000 });
    await makeProduct("sin-precio", { isPublic: true, price: null });
  }, 30000);

  afterAll(async () => {
    await cleanupFixtures(admin, "wholesale-featured", { productIds: Object.values(productIds) }, async (step) => {
      for (let i = 0; i < sectionIds.length; i += 50) {
        const ids = sectionIds.slice(i, i + 50);
        await step("wholesale_featured_sections", () => admin.from("wholesale_featured_sections").delete().in("id", ids));
      }
    });
  }, 30000);

  const both = [
    ["visitante anónimo", () => anon],
    ["usuaria autenticada", () => owner],
  ] as const;

  describe("catálogo sin secciones", () => {
    it("crear una sección no altera el catálogo general (mismos productos, mismo orden)", async () => {
      const before = (await fetchWholesaleCatalog(anon)).products.map((p) => p.id);
      await saveSection({ title: "Sección de control", products: ["A", "B"] });
      const after = (await fetchWholesaleCatalog(anon)).products.map((p) => p.id);
      expect(after).toEqual(before);
    });
  });

  for (const [label, getClient] of both) {
    describe(label, () => {
      it("sección activa sin fechas → aparece, con sus productos en el orden pedido", async () => {
        const { id } = await saveSection({ title: `Sin fechas ${label}`, products: ["C", "A", "B"] });
        const section = (await featuredFor(getClient())).find((s) => s.id === id);
        expect(section).toBeDefined();
        expect(namesOf(section!)).toEqual(["C", "A", "B"]);
      });

      it("sección inactiva → no aparece, aunque no tenga fechas", async () => {
        const { id } = await saveSection({ title: `Inactiva ${label}`, isActive: false, products: ["A"] });
        expect((await featuredFor(getClient())).some((s) => s.id === id)).toBe(false);
      });

      it("sección que todavía no empezó → no aparece", async () => {
        const { id } = await saveSection({ title: `Futura ${label}`, startsAt: FUTURE, endsAt: FAR_FUTURE, products: ["A"] });
        expect((await featuredFor(getClient())).some((s) => s.id === id)).toBe(false);
      });

      it("sección que ya terminó → no aparece", async () => {
        const { id } = await saveSection({ title: `Vencida ${label}`, startsAt: PAST, endsAt: PAST_END, products: ["A"] });
        expect((await featuredFor(getClient())).some((s) => s.id === id)).toBe(false);
      });

      it("sección dentro de su ventana de fechas → aparece", async () => {
        const { id } = await saveSection({ title: `Vigente ${label}`, startsAt: PAST, endsAt: FAR_FUTURE, products: ["A"] });
        expect((await featuredFor(getClient())).some((s) => s.id === id)).toBe(true);
      });

      it("un producto oculto en mayorista NO aparece aunque esté destacado; los demás sí", async () => {
        const { id } = await saveSection({ title: `Con oculto ${label}`, products: ["A", "oculto", "sin-precio", "B"] });
        const section = (await featuredFor(getClient())).find((s) => s.id === id);
        expect(namesOf(section!)).toEqual(["A", "B"]);
      });

      it("una sección cuyos productos están todos ocultos no se muestra", async () => {
        const { id } = await saveSection({ title: `Todo oculto ${label}`, products: ["oculto", "sin-precio"] });
        expect((await featuredFor(getClient())).some((s) => s.id === id)).toBe(false);
      });

      it("el producto destacado sigue apareciendo también en el catálogo general", async () => {
        const catalog = await fetchWholesaleCatalog(getClient());
        const names = catalog.products.map((p) => p.name);
        expect(names).toContain(`${PREFIX} A`);
        expect(names).toContain(`${PREFIX} B`);
      });
    });
  }

  describe("orden", () => {
    it("el orden de las secciones lo define sort_order y se puede reordenar", async () => {
      const first = await saveSection({ title: "Orden uno", products: ["A"] });
      const second = await saveSection({ title: "Orden dos", products: ["B"] });
      const third = await saveSection({ title: "Orden tres", products: ["C"] });

      const orderOf = async () => (await featuredFor(anon)).map((s) => s.id).filter((id) => [first.id, second.id, third.id].includes(id));
      expect(await orderOf()).toEqual([first.id, second.id, third.id]); // altas: al final

      const { error } = await owner.rpc("reorder_wholesale_featured_sections", {
        p_section_ids: [third.id, first.id, second.id],
      });
      expect(error).toBeNull();
      expect(await orderOf()).toEqual([third.id, first.id, second.id]);
    });

    it("el orden de los productos se reemplaza según el array (RPC atómica, sin duplicados)", async () => {
      const { id } = await saveSection({ title: "Orden de productos", products: ["A", "B", "C"] });
      const { error } = await saveSection({ id, title: "Orden de productos", products: ["C", "B", "A", "B"] });
      expect(error).toBeNull();
      const section = (await featuredFor(anon)).find((s) => s.id === id);
      expect(namesOf(section!)).toEqual(["C", "B", "A"]);
    });
  });

  describe("no se pierde nada al quitar o eliminar", () => {
    it("quitar un producto de una sección no elimina el producto", async () => {
      const { id } = await saveSection({ title: "Quitar producto", products: ["A", "B"] });
      await saveSection({ id, title: "Quitar producto", products: ["A"] });

      const { data: product } = await admin.from("products").select("id").eq("id", productIds["B"]);
      expect(product).toHaveLength(1);
      const { data: links } = await admin.from("wholesale_featured_section_products").select("product_id").eq("section_id", id!);
      expect(links?.map((l) => l.product_id)).toEqual([productIds["A"]]);
    });

    it("eliminar una sección borra sus asociaciones (cascade) pero nunca los productos", async () => {
      const { id } = await saveSection({ title: "Para eliminar", products: ["A", "B", "C"] });
      const { error } = await owner.from("wholesale_featured_sections").delete().eq("id", id!);
      expect(error).toBeNull();

      const { data: links } = await admin.from("wholesale_featured_section_products").select("product_id").eq("section_id", id!);
      expect(links).toHaveLength(0);
      const { data: products } = await admin.from("products").select("id").in("id", [productIds["A"], productIds["B"], productIds["C"]]);
      expect(products).toHaveLength(3);
    });

    it("un producto que pasa a oculto conserva su asociación (el editor lo avisa; no se borra sola)", async () => {
      const { id } = await saveSection({ title: "Asociación persistente", products: ["A", "oculto"] });
      const admins = await fetchFeaturedSectionsAdmin(owner);
      const section = admins.find((s) => s.id === id);
      expect(section?.products.map((p) => p.productId)).toEqual([productIds["A"], productIds["oculto"]]);
    });
  });

  describe("permisos y RLS", () => {
    it("un usuario de operations NO puede crear ni editar secciones (sólo owner)", async () => {
      const { error } = await saveSection({ title: "Intento operations", products: ["A"], client: ops });
      expect(error?.message).toMatch(/administradora/i);

      const { error: insertError } = await ops
        .from("wholesale_featured_sections")
        .insert({ title: "Directo operations", slug: `directo-ops-${Date.now()}` });
      expect(insertError).not.toBeNull();
    });

    it("operations no puede eliminar ni reordenar: la sección sigue ahí", async () => {
      const { id } = await saveSection({ title: "Protegida", products: ["A"] });
      const { data: deleted } = await ops.from("wholesale_featured_sections").delete().eq("id", id!).select("id");
      expect(deleted ?? []).toHaveLength(0);
      const { error: reorderError } = await ops.rpc("reorder_wholesale_featured_sections", { p_section_ids: [id] });
      expect(reorderError?.message).toMatch(/administradora/i);
      const { data: still } = await admin.from("wholesale_featured_sections").select("id").eq("id", id!);
      expect(still).toHaveLength(1);
    });

    it("anon no puede escribir", async () => {
      const { error } = await anon.from("wholesale_featured_sections").insert({ title: "Anon", slug: `anon-${Date.now()}` });
      expect(error).not.toBeNull();
      const { error: rpcError } = await anon.rpc("save_wholesale_featured_section", {
        p_id: null, p_title: "Anon", p_slug: `anon-rpc-${Date.now()}`, p_description: null, p_is_active: true,
        p_starts_at: null, p_ends_at: null, p_product_ids: [],
      });
      expect(rpcError).not.toBeNull();
    });

    it("anon sólo lee secciones activas y vigentes, y sólo relaciones con productos públicos", async () => {
      const live = await saveSection({ title: "RLS viva", products: ["A", "oculto"] });
      const inactive = await saveSection({ title: "RLS inactiva", isActive: false, products: ["A"] });
      const expired = await saveSection({ title: "RLS vencida", startsAt: PAST, endsAt: PAST_END, products: ["A"] });

      const { data: sections } = await anon.from("wholesale_featured_sections").select("id").in("id", [live.id, inactive.id, expired.id]);
      expect(sections?.map((s) => s.id)).toEqual([live.id]);

      const { data: links } = await anon
        .from("wholesale_featured_section_products")
        .select("product_id")
        .in("section_id", [live.id, inactive.id, expired.id]);
      expect(links?.map((l) => l.product_id)).toEqual([productIds["A"]]); // el oculto no
    });
  });

  describe("integridad", () => {
    it("guardar es atómico: con un producto inexistente no queda la sección creada a medias", async () => {
      const title = `Atómica ${Date.now()}`;
      const { error } = await owner.rpc("save_wholesale_featured_section", {
        p_id: null, p_title: title, p_slug: `atomica-${Date.now()}`, p_description: null, p_is_active: true,
        p_starts_at: null, p_ends_at: null, p_product_ids: ["00000000-0000-4000-8000-000000000000"],
      });
      expect(error).not.toBeNull();
      const { data } = await admin.from("wholesale_featured_sections").select("id").eq("title", title);
      expect(data).toHaveLength(0);
    });

    it("rechaza fechas de fin anteriores a las de inicio", async () => {
      const { error } = await saveSection({ title: "Fechas al revés", startsAt: FAR_FUTURE, endsAt: PAST });
      expect(error).not.toBeNull();
    });

    it("editar no cambia el slug (ancla estable)", async () => {
      const { id } = await saveSection({ title: "Slug estable", products: ["A"] });
      const { data: before } = await admin.from("wholesale_featured_sections").select("slug").eq("id", id!).single();
      await saveSection({ id, title: "Slug estable renombrada", products: ["A"] });
      const { data: after } = await admin.from("wholesale_featured_sections").select("slug,title").eq("id", id!).single();
      expect(after?.slug).toBe(before?.slug);
      expect(after?.title).toBe("Slug estable renombrada");
    });
  });

  describe("selector de productos del editor (getProductsPage con wholesaleOnly)", () => {
    // Misma query que getProductsPage(..., { wholesaleOnly: true }) —
    // createClient() de server usa cookies, así que se replica contra
    // supabase-js "plano" (mismo criterio que el resto de tests de este repo).
    const pick = (search: string) =>
      owner
        .from("products")
        .select("id,name,wholesale_product_rules!inner(is_public)")
        .eq("is_active", true)
        .eq("wholesale_product_rules.is_public", true)
        .ilike("name", `%${search}%`)
        .order("name")
        .limit(20);

    it("ofrece los productos habilitados para mayorista y NO los ocultos", async () => {
      const { data } = await pick(PREFIX);
      const names = (data ?? []).map((p) => p.name.replace(`${PREFIX} `, ""));
      expect(names).toContain("A");
      expect(names).toContain("sin-precio"); // habilitado: el picker lo marca "sin precio", no lo esconde
      expect(names).not.toContain("oculto");
    });

    it("busca server-side y acotado a 20, sin traer el catálogo entero", async () => {
      const { data } = await pick("fixture");
      expect((data ?? []).length).toBeLessThanOrEqual(20);
    });
  });
});
