import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupFixtures } from "../../../tests/support/fixture-cleanup";

// Server Action duplicateProduct + deleteProductImage con imágenes
// COMPARTIDAS, contra Supabase LOCAL real y la sesión de cada rol. Se mockean
// sólo las costuras de Next (sesión, cliente de servidor, revalidatePath).

type Role = "owner" | "operations" | "viewer";
let currentRole: Role = "owner";
let currentClient: SupabaseClient;

vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "test-user", roles: [currentRole] }),
  isOwner: (u: { roles: string[] }) => u.roles.includes("owner"),
  hasRole: (u: { roles: string[] }, r: string) => u.roles.includes(r),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => currentClient }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { duplicateProduct } = await import("./actions");
const { deleteProductImage } = await import("./[id]/actions");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";
const EMAILS: Record<Role, string> = {
  owner: "owner-test@pottery.local",
  operations: "operations-test@pottery.local",
  viewer: "viewer-test@pottery.local",
};

describe("duplicateProduct (acción) y archivos compartidos (local)", { timeout: 30000 }, () => {
  let admin: SupabaseClient;
  const clients = {} as Record<Role, SupabaseClient>;
  let sourceId: string;
  let sharedPath: string;
  const productIds: string[] = [];
  const storagePaths: string[] = [];

  const as = (role: Role) => {
    currentRole = role;
    currentClient = clients[role];
  };
  const fileExists = async (path: string) => (await admin.storage.from("product-images").download(path)).data !== null;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    for (const role of Object.keys(EMAILS) as Role[]) {
      const { data: users } = await admin.auth.admin.listUsers();
      if (!users.users.find((u) => u.email === EMAILS[role])) {
        const { data: created, error } = await admin.auth.admin.createUser({ email: EMAILS[role], password: PASSWORD, email_confirm: true });
        if (error) throw error;
        await admin.from("user_roles").insert({ user_id: created.user!.id, role });
      }
      const c = createClient(SUPABASE_URL, ANON_KEY);
      const { error } = await c.auth.signInWithPassword({ email: EMAILS[role], password: PASSWORD });
      if (error) throw error;
      clients[role] = c;
    }

    const { data: p } = await admin.from("products").insert({ name: "0 Duplicar Accion Original" }).select("id").single();
    sourceId = p!.id;
    productIds.push(sourceId);
    sharedPath = `${sourceId}/foto.jpg`;
    await admin.storage.from("product-images").upload(sharedPath, Buffer.from("foto"), { contentType: "image/jpeg", upsert: true });
    storagePaths.push(sharedPath);
    await admin.from("product_images").insert({ product_id: sourceId, storage_path: sharedPath, is_primary: true });
  }, 60000);

  // Conteo acotado a las copias de ESTE fixture (nombre con prefijo propio): un
  // count global de `products` se contaminaría con otros tests en paralelo.
  const attemptsCount = async () =>
    (await admin.from("products").select("id", { count: "exact", head: true }).like("name", "0 Duplicar Accion%")).count;

  beforeEach(() => as("owner"));

  afterAll(async () => {
    await admin.storage.from("product-images").remove(storagePaths);
    await cleanupFixtures(admin, "duplicate-product-action", { productIds });
  }, 60000);

  describe("duplicateProduct", () => {
    it("owner + nombre válido → { productId } y el producto nuevo existe con ese nombre", async () => {
      const result = await duplicateProduct(sourceId, "  0 Duplicar Accion Copia 1  ", false);
      expect(result.error).toBeUndefined();
      productIds.push(result.productId!);
      const { data } = await admin.from("products").select("name").eq("id", result.productId!).single();
      expect(data!.name).toBe("0 Duplicar Accion Copia 1");
    });

    it("el flag de publicar llega a la RPC: sin regla original no hay regla en la copia; con regla pública se respeta", async () => {
      await admin.from("wholesale_product_rules").insert({ product_id: sourceId, is_public: true });
      const hidden = await duplicateProduct(sourceId, "0 Duplicar Accion Oculta", false);
      const shown = await duplicateProduct(sourceId, "0 Duplicar Accion Publica", true);
      productIds.push(hidden.productId!, shown.productId!);
      const rule = async (id: string) => (await admin.from("wholesale_product_rules").select("is_public").eq("product_id", id).single()).data!.is_public;
      expect(await rule(hidden.productId!)).toBe(false);
      expect(await rule(shown.productId!)).toBe(true);
    });

    it("nombre vacío, sólo espacios o igual al original → error y NO se crea nada", async () => {
      const before = await attemptsCount();
      for (const name of ["", "   ", "0 Duplicar Accion Original", "  0 Duplicar Accion Original "]) {
        const r = await duplicateProduct(sourceId, name, false);
        expect(r.productId).toBeUndefined();
        expect(r.error).toBeTruthy();
      }
      expect(await attemptsCount()).toBe(before);
    });

    it("operations y viewer → rechazados con mensaje claro y sin efectos", async () => {
      const before = await attemptsCount();
      for (const role of ["operations", "viewer"] as Role[]) {
        as(role);
        const r = await duplicateProduct(sourceId, "0 Duplicar Accion Sin Permiso", false);
        expect(r).toEqual({ error: "Sólo la administradora puede duplicar productos." });
      }
      expect(await attemptsCount()).toBe(before);
    });

    it("id inválido o inexistente → error, sin excepción", async () => {
      expect((await duplicateProduct("no-es-uuid", "0 Duplicar Accion X", false)).error).toBeTruthy();
      expect((await duplicateProduct("00000000-0000-4000-8000-000000000000", "0 Duplicar Accion X", false)).error).toMatch(/no existe/);
    });
  });

  describe("imágenes compartidas entre original y copia", () => {
    it("quitar la imagen de la COPIA no borra el archivo ni la imagen del ORIGINAL; quitar la última referencia sí borra el archivo", async () => {
      // Producto propio (las copias de los tests anteriores también referencian `sharedPath`).
      const { data: own } = await admin.from("products").insert({ name: "0 Duplicar Accion Propio" }).select("id").single();
      productIds.push(own!.id);
      const path = `${own!.id}/propia.jpg`;
      await admin.storage.from("product-images").upload(path, Buffer.from("propia"), { contentType: "image/jpeg", upsert: true });
      storagePaths.push(path);
      await admin.from("product_images").insert({ product_id: own!.id, storage_path: path, is_primary: true });

      const dup = await duplicateProduct(own!.id, "0 Duplicar Accion Compartida", false);
      productIds.push(dup.productId!);
      const copyImage = (await admin.from("product_images").select("id,storage_path").eq("product_id", dup.productId!).single()).data!;
      expect(copyImage.storage_path).toBe(path); // mismo archivo, no re-subido
      expect(await fileExists(path)).toBe(true);

      // Juli reemplaza la foto de la copia: la borra.
      await deleteProductImage(dup.productId!, copyImage.id, copyImage.storage_path);
      expect((await admin.from("product_images").select("id").eq("id", copyImage.id)).data).toHaveLength(0);
      expect(await fileExists(path)).toBe(true); // el original sigue viéndose
      expect((await admin.from("product_images").select("id").eq("product_id", own!.id)).data).toHaveLength(1);

      // Otra copia sigue referenciando el archivo: aunque se borre la del original, se conserva.
      const dup2 = await duplicateProduct(own!.id, "0 Duplicar Accion Compartida 2", false);
      productIds.push(dup2.productId!);
      const originalImage = (await admin.from("product_images").select("id").eq("product_id", own!.id).single()).data!;
      await deleteProductImage(own!.id, originalImage.id, path);
      expect(await fileExists(path)).toBe(true); // lo referencia todavía la copia 2

      // Última referencia → ahora sí se elimina el archivo.
      const lastImage = (await admin.from("product_images").select("id").eq("product_id", dup2.productId!).single()).data!;
      await deleteProductImage(dup2.productId!, lastImage.id, path);
      expect(await fileExists(path)).toBe(false);
    });

    it("una imagen NO compartida se borra del Storage como siempre", async () => {
      const path = `${sourceId}/unica.jpg`;
      await admin.storage.from("product-images").upload(path, Buffer.from("x"), { contentType: "image/jpeg", upsert: true });
      storagePaths.push(path);
      const { data: img } = await admin.from("product_images").insert({ product_id: sourceId, storage_path: path }).select("id").single();
      await deleteProductImage(sourceId, img!.id, path);
      expect(await fileExists(path)).toBe(false);
    });
  });
});
