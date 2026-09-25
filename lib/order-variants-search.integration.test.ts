import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupFixtures } from "../tests/support/fixture-cleanup";
import { searchOrderVariants, searchSaleVariants } from "./product-search";

// searchOrderVariants (/pedidos/nuevo) y searchSaleVariants (/ventas/nueva)
// REALES contra Supabase LOCAL, con la sesión de una usuaria del backoffice
// (el cliente de navegador se inyecta: acá no hay navegador). Cubre: precios
// de las dos listas por variante, variantes sin precio mayorista/minorista,
// que la venta rápida siga exigiendo precio minorista (sin regresión) y que
// las listas restringidas de /precios no se cuelen como retail/wholesale.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";
const OPERATIONS_EMAIL = "operations-test@pottery.local";

// Prefijo único por corrida: las búsquedas se acotan a este producto.
const RUN = `ZZOV${Date.now().toString(36)}`;
const NAME = `${RUN} Taza`;

describe("searchOrderVariants (local)", { timeout: 30000 }, () => {
  let admin: SupabaseClient;
  let ops: SupabaseClient;
  let restrictedListId: string;
  const productIds: string[] = [];
  const variantIds: Record<string, string> = {};

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: users } = await admin.auth.admin.listUsers();
    if (!users.users.find((u) => u.email === OPERATIONS_EMAIL)) {
      const { data: created, error } = await admin.auth.admin.createUser({ email: OPERATIONS_EMAIL, password: PASSWORD, email_confirm: true });
      if (error) throw error;
      await admin.from("user_roles").insert({ user_id: created.user!.id, role: "operations" });
    }
    ops = createClient(SUPABASE_URL, ANON_KEY);
    const { error: signInError } = await ops.auth.signInWithPassword({ email: OPERATIONS_EMAIL, password: PASSWORD });
    if (signInError) throw signInError;

    const retail = (await admin.from("price_lists").select("id").eq("code", "retail").single()).data!.id as string;
    const wholesale = (await admin.from("price_lists").select("id").eq("code", "wholesale").single()).data!.id as string;
    restrictedListId = (await admin.from("price_lists").insert({ code: `zz-ov-restricted-${RUN}`, name: "Restringida fixture" }).select("id").single()).data!.id;

    const { data: product } = await admin.from("products").insert({ name: NAME, is_active: true }).select("id").single();
    productIds.push(product!.id);
    await admin.from("product_variants").delete().eq("product_id", product!.id); // descarta la "Único" del trigger

    const mkVariant = async (name: string, prices: { list: string; price: number }[]) => {
      const { data: v } = await admin.from("product_variants").insert({ product_id: product!.id, name, is_active: true }).select("id").single();
      variantIds[name] = v!.id;
      for (const p of prices) await admin.from("price_list_items").insert({ price_list_id: p.list, product_variant_id: v!.id, unit_price: p.price });
    };
    await mkVariant("Ambos", [{ list: retail, price: 10000 }, { list: wholesale, price: 6000 }]);
    await mkVariant("Sólo minorista", [{ list: retail, price: 8000 }]);
    await mkVariant("Sólo mayorista", [{ list: wholesale, price: 5000 }]);
    await mkVariant("Sin precios", []);
    // Precio en una lista restringida: no es ni retail ni wholesale.
    await mkVariant("Sólo restringida", [{ list: restrictedListId, price: 1 }]);
  });

  afterAll(async () => {
    await cleanupFixtures(admin, "order-variants-search", { productIds });
    await admin.from("price_lists").delete().eq("id", restrictedListId);
  });

  const search = async () => {
    const outcome = await searchOrderVariants(NAME, ops);
    if ("error" in outcome) throw new Error("searchOrderVariants falló");
    return Object.fromEntries(outcome.results.map((r) => [r.label, r.prices]));
  };

  it("trae el precio de las DOS listas por variante", async () => {
    const byLabel = await search();
    expect(byLabel[`${NAME} — Ambos`]).toEqual({ retail: 10000, wholesale: 6000 });
  });

  it("variante con precios distintos por lista: cada lista su precio", async () => {
    const byLabel = await search();
    expect(byLabel[`${NAME} — Sólo minorista`]).toEqual({ retail: 8000, wholesale: null });
    expect(byLabel[`${NAME} — Sólo mayorista`]).toEqual({ retail: null, wholesale: 5000 });
  });

  it("una variante sin precio mayorista (o sin ningún precio) aparece igual, con null", async () => {
    const byLabel = await search();
    expect(byLabel[`${NAME} — Sin precios`]).toEqual({ retail: null, wholesale: null });
    expect(byLabel[`${NAME} — Sólo restringida`]).toEqual({ retail: null, wholesale: null });
  });

  it("no regresión: la venta rápida sigue exigiendo precio minorista", async () => {
    const outcome = await searchSaleVariants(NAME, ops);
    if ("error" in outcome) throw new Error("searchSaleVariants falló");
    const labels = outcome.results.map((r) => r.label).sort();
    expect(labels).toEqual([`${NAME} — Ambos`, `${NAME} — Sólo minorista`].sort());
    expect(outcome.results.find((r) => r.label === `${NAME} — Ambos`)?.retailPrice).toBe(10000);
  });

  it("no incluye variantes inactivas ni de productos inactivos", async () => {
    await admin.from("product_variants").update({ is_active: false }).eq("id", variantIds["Ambos"]);
    const byLabel = await search();
    expect(byLabel[`${NAME} — Ambos`]).toBeUndefined();
    await admin.from("product_variants").update({ is_active: true }).eq("id", variantIds["Ambos"]);

    await admin.from("products").update({ is_active: false }).eq("id", productIds[0]);
    expect(await search()).toEqual({});
    await admin.from("products").update({ is_active: true }).eq("id", productIds[0]);
  });
});
