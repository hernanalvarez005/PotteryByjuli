import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupFixtures } from "../tests/support/fixture-cleanup";

// duplicate_product (RPC transaccional) contra Supabase LOCAL real, con la
// sesión de cada rol. Cubre: deep clone de variantes/precios/imágenes/reglas,
// stock 0 y cero histórico, atomicidad, nombre, permisos y compatibilidad con
// secciones destacadas.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";
const USERS = {
  owner: "owner-test@pottery.local",
  operations: "operations-test@pottery.local",
  viewer: "viewer-test@pottery.local",
} as const;
type Role = keyof typeof USERS;

const NAME = "0 Duplicar Fixture Original";

// Varias RPC y operaciones de Storage encadenadas por caso: se da margen sobre los 5 s
// por defecto para que la latencia de Docker en una corrida en paralelo no dé falsos rojos.
describe("duplicate_product (local)", { timeout: 30000 }, () => {
  let admin: SupabaseClient;
  const clients = {} as Record<Role, SupabaseClient>;
  let sourceId: string;
  let categoryId: string;
  let locationId: string;
  let retailListId: string;
  let wholesaleListId: string;
  let extraListId: string;
  let sectionId: string;
  let orderId: string;
  let sourceInventoryItemId: string;
  const variantIdByName: Record<string, string> = {};
  const productIds: string[] = [];
  const storagePaths: string[] = [];

  async function signIn(role: Role) {
    const { data: users } = await admin.auth.admin.listUsers();
    if (!users.users.find((u) => u.email === USERS[role])) {
      const { data: created, error } = await admin.auth.admin.createUser({ email: USERS[role], password: PASSWORD, email_confirm: true });
      if (error) throw error;
      await admin.from("user_roles").insert({ user_id: created.user!.id, role });
    }
    const c = createClient(SUPABASE_URL, ANON_KEY);
    const { error } = await c.auth.signInWithPassword({ email: USERS[role], password: PASSWORD });
    if (error) throw error;
    clients[role] = c;
  }

  const duplicate = async (name: string, publish = false, sourceProduct = sourceId, role: Role = "owner") => {
    const r = await clients[role].rpc("duplicate_product", { p_source_product_id: sourceProduct, p_new_name: name, p_publish_in_wholesale: publish });
    if (!r.error && r.data) productIds.push(r.data as string);
    return r;
  };

  // Conteos ACOTADOS a los productos de este fixture (los copia y el original
  // comparten descripción): un count global de `products` se contaminaría con
  // otros archivos de test que corren en paralelo.
  const familyCount = async () =>
    (await admin.from("products").select("id", { count: "exact", head: true }).eq("description", "Descripción original")).count;

  const variantsOf = async (productId: string) =>
    (await admin.from("product_variants").select("id,name,sku,sort_order,is_active").eq("product_id", productId).order("sort_order").order("name")).data ?? [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    for (const role of Object.keys(USERS) as Role[]) await signIn(role);

    categoryId = (await admin.from("product_categories").select("id").limit(1).single()).data!.id;
    locationId = (await admin.from("locations").select("id").limit(1).single()).data!.id;
    retailListId = (await admin.from("price_lists").select("id").eq("code", "retail").single()).data!.id;
    wholesaleListId = (await admin.from("price_lists").select("id").eq("code", "wholesale").single()).data!.id;
    const { data: extra } = await admin.from("price_lists").insert({ code: `zz-dup-fixture-${Date.now()}`, name: "Lista extra fixture" }).select("id").single();
    extraListId = extra!.id;

    // Producto ORIGINAL: 3 variantes (sin "Único"), categoría, costo, descripción.
    const { data: product } = await admin
      .from("products")
      .insert({ name: NAME, category_id: categoryId, description: "Descripción original", cost_estimate: 4321, is_active: true })
      .select("id")
      .single();
    sourceId = product!.id;
    productIds.push(sourceId);
    await admin.from("product_variants").delete().eq("product_id", sourceId); // descarta la "Único" del trigger
    for (const [i, name] of ["Bordó", "Azul", "Verde"].entries()) {
      const { data: v } = await admin.from("product_variants").insert({ product_id: sourceId, name, sku: `ZZ-DUP-${Date.now()}-${i}`, sort_order: i, is_active: name !== "Verde" }).select("id").single();
      variantIdByName[name] = v!.id;
      await admin.from("price_list_items").insert([
        { price_list_id: retailListId, product_variant_id: v!.id, unit_price: 10000 + i * 1000 },
        { price_list_id: wholesaleListId, product_variant_id: v!.id, unit_price: 7000 + i * 500 },
        { price_list_id: extraListId, product_variant_id: v!.id, unit_price: 5000 + i },
      ]);
    }

    // Imágenes: una general (primaria) y una de la variante Azul. Archivos reales.
    for (const [file, variant, primary, sort] of [
      ["general.jpg", null, true, 0],
      ["azul.jpg", "Azul", false, 1],
    ] as const) {
      const path = `${sourceId}/${file}`;
      await admin.storage.from("product-images").upload(path, Buffer.from(`img-${file}`), { contentType: "image/jpeg", upsert: true });
      storagePaths.push(path);
      await admin.from("product_images").insert({ product_id: sourceId, variant_id: variant ? variantIdByName[variant] : null, storage_path: path, is_primary: primary, sort_order: sort });
    }

    await admin.from("wholesale_product_rules").insert({ product_id: sourceId, is_public: true, min_quantity: 4, multiple_of: 2, lead_time_days: 15 });

    // TRANSACCIONAL/HISTÓRICO del original (nada de esto debe pasar a la copia):
    const { data: inv } = await admin.from("inventory_items").select("id").eq("product_variant_id", variantIdByName["Bordó"]).single();
    await admin.from("inventory_movements").insert({ inventory_item_id: inv!.id, location_id: locationId, movement_type: "adjustment", quantity: 10, reason: "fixture" });
    sourceInventoryItemId = inv!.id;
    await admin.from("stock_thresholds").insert({ inventory_item_id: inv!.id, location_id: locationId, min_quantity: 5 });
    const unitId = (await admin.from("business_units").select("id").eq("code", "retail").single()).data!.id;
    const { data: order } = await admin.from("orders").insert({ business_unit_id: unitId, operation_type: "order" }).select("id").single();
    orderId = order!.id;
    await admin.from("order_items").insert({ order_id: orderId, product_variant_id: variantIdByName["Bordó"], quantity: 1, unit_price: 10000 });

    // Campaña editorial que incluye al original.
    const { data: section } = await admin.from("wholesale_featured_sections").insert({ title: "Fixture campaña", slug: `fixture-dup-${Date.now()}` }).select("id").single();
    sectionId = section!.id;
    await admin.from("wholesale_featured_section_products").insert({ section_id: sectionId, product_id: sourceId, sort_order: 0 });
  }, 60000);

  afterAll(async () => {
    await admin.storage.from("product-images").remove(storagePaths);
    await cleanupFixtures(admin, "duplicate-product", { productIds, orderIds: orderId ? [orderId] : [] }, async (step) => {
      if (sectionId) await step("sections", () => admin.from("wholesale_featured_sections").delete().eq("id", sectionId));
      // stock_thresholds referencia inventory_items con NO ACTION: hay que borrarlo antes que el producto.
      if (sourceInventoryItemId) await step("stock_thresholds", () => admin.from("stock_thresholds").delete().eq("inventory_item_id", sourceInventoryItemId));
    });
    if (extraListId) await admin.from("price_lists").delete().eq("id", extraListId);
  }, 60000);

  describe("básico", () => {
    it("duplica: id nuevo, nombre nuevo, el original NO cambia", async () => {
      const before = (await admin.from("products").select("*").eq("id", sourceId).single()).data;
      const { data: newId, error } = await duplicate("0 Duplicar Fixture Copia A");
      expect(error).toBeNull();
      expect(newId).not.toBe(sourceId);

      const copy = (await admin.from("products").select("*").eq("id", newId as string).single()).data!;
      expect(copy.name).toBe("0 Duplicar Fixture Copia A");
      expect(copy.category_id).toBe(categoryId);
      expect(copy.description).toBe("Descripción original");
      expect(Number(copy.cost_estimate)).toBe(4321);
      expect(copy.is_active).toBe(true); // se conserva
      expect(copy.external_source).toBeNull();
      expect(copy.external_id).toBeNull();

      expect((await admin.from("products").select("*").eq("id", sourceId).single()).data).toEqual(before);
    });

    it("el nombre se guarda sin espacios sobrantes", async () => {
      const { data: newId } = await duplicate("   0 Duplicar Fixture Trim   ");
      expect((await admin.from("products").select("name").eq("id", newId as string).single()).data!.name).toBe("0 Duplicar Fixture Trim");
    });

    it("un producto INACTIVO se duplica inactivo (is_active se conserva)", async () => {
      const { data: inactive } = await admin.from("products").insert({ name: "0 Duplicar Fixture Inactivo", is_active: false }).select("id").single();
      productIds.push(inactive!.id);
      const { data: newId } = await duplicate("0 Duplicar Fixture Inactivo Copia", false, inactive!.id);
      expect((await admin.from("products").select("is_active").eq("id", newId as string).single()).data!.is_active).toBe(false);
    });
  });

  describe("variantes", () => {
    it("mismas variantes (nombre, orden, estado), ids NUEVOS, ligadas al producto nuevo, sin SKU", async () => {
      const { data: newId } = await duplicate("0 Duplicar Fixture Variantes");
      const original = await variantsOf(sourceId);
      const copy = await variantsOf(newId as string);

      expect(copy.map((v) => [v.name, v.sort_order, v.is_active])).toEqual(original.map((v) => [v.name, v.sort_order, v.is_active]));
      expect(copy).toHaveLength(3);
      const originalIds = new Set(original.map((v) => v.id));
      expect(copy.every((v) => !originalIds.has(v.id))).toBe(true);
      expect(copy.every((v) => v.sku === null)).toBe(true); // SKU es único: no se copia
      expect(original.every((v) => v.sku !== null)).toBe(true); // y el original conserva el suyo
    });

    it("NO queda una variante 'Único' extra (la del trigger se descarta)", async () => {
      const { data: newId } = await duplicate("0 Duplicar Fixture Sin Unico");
      expect((await variantsOf(newId as string)).map((v) => v.name)).not.toContain("Único");
    });

    it("un producto sólo con la variante 'Único' se duplica con su 'Único' (una sola)", async () => {
      const { data: simple } = await admin.from("products").insert({ name: "0 Duplicar Fixture Simple" }).select("id").single();
      productIds.push(simple!.id);
      const { data: newId } = await duplicate("0 Duplicar Fixture Simple Copia", false, simple!.id);
      expect((await variantsOf(newId as string)).map((v) => v.name)).toEqual(["Único"]);
    });
  });

  describe("precios", () => {
    it("mismos importes en TODAS las listas, apuntando a las variantes NUEVAS (nunca a las originales)", async () => {
      const { data: newId } = await duplicate("0 Duplicar Fixture Precios");
      const copyVariants = await variantsOf(newId as string);
      const copyIds = copyVariants.map((v) => v.id);
      const originalIds = Object.values(variantIdByName);

      const { data: copyPrices } = await admin.from("price_list_items").select("price_list_id,product_variant_id,unit_price").in("product_variant_id", copyIds);
      expect(copyPrices).toHaveLength(9); // 3 variantes × 3 listas

      const nameOf = new Map(copyVariants.map((v) => [v.id, v.name]));
      for (const [name, originalId] of Object.entries(variantIdByName)) {
        const { data: originalPrices } = await admin.from("price_list_items").select("price_list_id,unit_price").eq("product_variant_id", originalId);
        const copied = copyPrices!.filter((p) => nameOf.get(p.product_variant_id) === name).map((p) => `${p.price_list_id}:${Number(p.unit_price)}`).sort();
        expect(copied).toEqual((originalPrices ?? []).map((p) => `${p.price_list_id}:${Number(p.unit_price)}`).sort());
      }
      // Ningún precio nuevo cuelga de una variante original, y el original sigue con los suyos.
      expect(copyPrices!.some((p) => originalIds.includes(p.product_variant_id))).toBe(false);
      const { data: stillOriginal } = await admin.from("price_list_items").select("id").in("product_variant_id", originalIds);
      expect(stillOriginal).toHaveLength(9);
    });
  });

  describe("imágenes", () => {
    it("copia las FILAS (misma ruta de archivo, primaria y orden); la de variante se remapea a la variante nueva", async () => {
      const { data: newId } = await duplicate("0 Duplicar Fixture Imagenes");
      const copyVariants = await variantsOf(newId as string);
      const { data: images } = await admin.from("product_images").select("product_id,variant_id,storage_path,is_primary,sort_order").eq("product_id", newId as string).order("sort_order");

      expect(images).toHaveLength(2);
      expect(images![0]).toMatchObject({ storage_path: `${sourceId}/general.jpg`, variant_id: null, is_primary: true, sort_order: 0 });
      expect(images![1]).toMatchObject({ storage_path: `${sourceId}/azul.jpg`, is_primary: false, sort_order: 1 });
      expect(images![1].variant_id).toBe(copyVariants.find((v) => v.name === "Azul")!.id);
      expect(images![1].variant_id).not.toBe(variantIdByName["Azul"]);
    });

    it("el original no se modifica y los archivos NO se duplican en Storage", async () => {
      const { data: originals } = await admin.from("product_images").select("storage_path,variant_id").eq("product_id", sourceId);
      expect(originals).toHaveLength(2);
      expect(originals!.find((i) => i.storage_path.endsWith("azul.jpg"))!.variant_id).toBe(variantIdByName["Azul"]);
      const { data: files } = await admin.storage.from("product-images").list(sourceId);
      expect((files ?? []).map((f) => f.name).sort()).toEqual(["azul.jpg", "general.jpg"]);
    });
  });

  describe("configuración mayorista", () => {
    it("por defecto la copia queda OCULTA en mayorista y conserva mínimos/múltiplos/plazo", async () => {
      const { data: newId } = await duplicate("0 Duplicar Fixture Mayorista Oculta");
      expect((await admin.from("wholesale_product_rules").select("is_public,min_quantity,multiple_of,lead_time_days").eq("product_id", newId as string).single()).data).toEqual({
        is_public: false, min_quantity: 4, multiple_of: 2, lead_time_days: 15,
      });
    });

    it("con publicar=true conserva la visibilidad del original", async () => {
      const { data: newId } = await duplicate("0 Duplicar Fixture Mayorista Publica", true);
      expect((await admin.from("wholesale_product_rules").select("is_public").eq("product_id", newId as string).single()).data!.is_public).toBe(true);
    });

    it("publicar=true NO publica una copia cuyo original no era público", async () => {
      await admin.from("wholesale_product_rules").update({ is_public: false }).eq("product_id", sourceId);
      const { data: newId } = await duplicate("0 Duplicar Fixture Mayorista NoPublico", true);
      expect((await admin.from("wholesale_product_rules").select("is_public").eq("product_id", newId as string).single()).data!.is_public).toBe(false);
      await admin.from("wholesale_product_rules").update({ is_public: true }).eq("product_id", sourceId);
    });

    it("un original sin fila de reglas → la copia tampoco la tiene (nunca fue habilitado)", async () => {
      const { data: plain } = await admin.from("products").insert({ name: "0 Duplicar Fixture Sin Reglas" }).select("id").single();
      productIds.push(plain!.id);
      const { data: newId } = await duplicate("0 Duplicar Fixture Sin Reglas Copia", true, plain!.id);
      expect((await admin.from("wholesale_product_rules").select("product_id").eq("product_id", newId as string)).data).toHaveLength(0);
    });

    it("NO copia la pertenencia a secciones destacadas (es editorial)", async () => {
      const { data: newId } = await duplicate("0 Duplicar Fixture Campana", true);
      const { data: links } = await admin.from("wholesale_featured_section_products").select("section_id").eq("product_id", newId as string);
      expect(links).toHaveLength(0);
      const { data: original } = await admin.from("wholesale_featured_section_products").select("section_id").eq("product_id", sourceId);
      expect(original).toHaveLength(1); // el original sigue en su campaña
    });
  });

  describe("inventario e histórico: la copia nace limpia", () => {
    it("stock 0: sin movimientos, sin reservas, sin umbrales — aunque el original tenga stock", async () => {
      const { data: newId } = await duplicate("0 Duplicar Fixture Stock");
      const copyVariantIds = (await variantsOf(newId as string)).map((v) => v.id);
      const { data: items } = await admin.from("inventory_items").select("id,unit,item_type").in("product_variant_id", copyVariantIds);
      expect(items).toHaveLength(3); // un inventory_item por variante (creado por el trigger)
      const itemIds = items!.map((i) => i.id);

      const { data: movements } = await admin.from("inventory_movements").select("quantity").in("inventory_item_id", itemIds);
      const { data: reservations } = await admin.from("inventory_reservations").select("id").in("inventory_item_id", itemIds);
      const { data: thresholds } = await admin.from("stock_thresholds").select("id").in("inventory_item_id", itemIds);
      expect(movements).toHaveLength(0);
      expect(reservations).toHaveLength(0);
      expect(thresholds).toHaveLength(0);
      expect((movements ?? []).reduce((s, m) => s + Number(m.quantity), 0)).toBe(0);

      // El original conserva su stock y su historial intactos.
      const originalItem = (await admin.from("inventory_items").select("id").eq("product_variant_id", variantIdByName["Bordó"]).single()).data!;
      const { data: originalMovements } = await admin.from("inventory_movements").select("quantity").eq("inventory_item_id", originalItem.id);
      expect(originalMovements!.reduce((s, m) => s + Number(m.quantity), 0)).toBe(10);
    });

    it("sin ventas, pedidos, producción ni transferencias en la copia; el original conserva su venta", async () => {
      const { data: newId } = await duplicate("0 Duplicar Fixture Historico");
      const copyVariantIds = (await variantsOf(newId as string)).map((v) => v.id);
      expect((await admin.from("order_items").select("id").in("product_variant_id", copyVariantIds)).data).toHaveLength(0);
      expect((await admin.from("production_orders").select("id").in("product_variant_id", copyVariantIds)).data).toHaveLength(0);
      expect((await admin.from("order_items").select("id").eq("order_id", orderId)).data).toHaveLength(1);
    });
  });

  describe("nombre", () => {
    it("vacío o sólo espacios → error, sin crear nada", async () => {
      const before = await familyCount();
      for (const name of ["", "    "]) {
        const { error } = await duplicate(name);
        expect(error?.message).toMatch(/Falta el nuevo nombre/);
      }
      expect(await familyCount()).toBe(before);
    });

    it("igual al original (incluso con espacios) → error", async () => {
      for (const name of [NAME, `  ${NAME}  `]) {
        const { error } = await duplicate(name);
        expect(error?.message).toMatch(/distinto del original/);
      }
    });

    it("dos copias con el MISMO nombre nuevo están permitidas (los nombres no son únicos en este esquema)", async () => {
      const a = await duplicate("0 Duplicar Fixture Repetido");
      const b = await duplicate("0 Duplicar Fixture Repetido");
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();
      expect(a.data).not.toBe(b.data);
    });

    it("un producto inexistente → error claro", async () => {
      const { error } = await duplicate("0 Duplicar Fixture X", false, "00000000-0000-4000-8000-000000000000");
      expect(error?.message).toMatch(/no existe/);
    });
  });

  describe("atomicidad", () => {
    it("un error INTERMEDIO (imagen ligada a una variante ajena, tras crear producto y variantes) no deja NADA a medias", async () => {
      const brokenMarker = `ROTO-${Date.now()}`;
      const { data: broken } = await admin.from("products").insert({ name: "0 Duplicar Fixture Roto", description: brokenMarker }).select("id").single();
      productIds.push(broken!.id);
      // Imagen del producto "roto" apuntando a una variante de OTRO producto (dato inconsistente).
      await admin.from("product_images").insert({ product_id: broken!.id, variant_id: variantIdByName["Azul"], storage_path: `${sourceId}/general.jpg` });

      const { error } = await duplicate("0 Duplicar Fixture Roto Copia", false, broken!.id);
      expect(error?.message).toMatch(/imagen asociada a una variante/);

      // El producto de la copia (que ya se había insertado con sus variantes cuando saltó el
      // error) NO existe: ni por nombre, ni por la descripción única heredada (sólo queda el "roto").
      expect((await admin.from("products").select("id").eq("name", "0 Duplicar Fixture Roto Copia")).data).toHaveLength(0);
      expect((await admin.from("products").select("id").eq("description", brokenMarker)).data).toEqual([{ id: broken!.id }]);
    });
  });

  describe("permisos (sólo owner: duplicar escribe precios y reglas mayoristas)", () => {
    it("owner → OK", async () => {
      expect((await duplicate("0 Duplicar Fixture Owner", false, sourceId, "owner")).error).toBeNull();
    });

    it("operations → rechazado y sin efectos", async () => {
      const before = await familyCount();
      const { error } = await duplicate("0 Duplicar Fixture Ops", false, sourceId, "operations");
      expect(error?.message).toMatch(/Sólo la administradora/);
      expect(await familyCount()).toBe(before);
      expect((await admin.from("products").select("id").eq("name", "0 Duplicar Fixture Ops")).data).toHaveLength(0);
    });

    it("viewer → rechazado", async () => {
      expect((await duplicate("0 Duplicar Fixture Viewer", false, sourceId, "viewer")).error?.message).toMatch(/Sólo la administradora/);
    });

    it("anónimo → no puede ejecutar la RPC", async () => {
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      const { error } = await anon.rpc("duplicate_product", { p_source_product_id: sourceId, p_new_name: "0 Duplicar Fixture Anon" });
      expect(error).not.toBeNull();
    });
  });
});
