import { describe, it, expect } from "vitest";
import {
  fetchFeaturedSectionRows,
  fetchFeaturedSectionsAdmin,
  getFeaturedSectionStatus,
  resolveFeaturedSections,
  type FeaturedSectionRow,
} from "./wholesale-featured";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WholesaleProduct } from "./wholesale";

const NOW = new Date("2026-10-01T15:00:00Z");

function product(id: string): WholesaleProduct {
  return {
    id,
    name: `Producto ${id}`,
    description: null,
    categoryId: null,
    images: [],
    minQuantity: null,
    multipleOf: null,
    leadTimeDays: null,
    variants: [{ id: `${id}-v`, name: "Único", unitPrice: 1000 }],
  };
}

function section(overrides: Partial<FeaturedSectionRow> & { id: string; productIds?: string[] }): FeaturedSectionRow {
  const { productIds = [], ...rest } = overrides;
  return {
    title: `Sección ${overrides.id}`,
    slug: `seccion-${overrides.id}`,
    description: null,
    is_active: true,
    starts_at: null,
    ends_at: null,
    sort_order: 0,
    wholesale_featured_section_products: productIds.map((product_id, i) => ({ product_id, sort_order: i })),
    ...rest,
  };
}

const catalog = ["a", "b", "c", "d"].map(product);

describe("getFeaturedSectionStatus", () => {
  it("activa sin fechas → live", () => {
    expect(getFeaturedSectionStatus({ is_active: true, starts_at: null, ends_at: null }, NOW)).toBe("live");
  });
  it("is_active=false gana sobre cualquier fecha → inactive", () => {
    expect(
      getFeaturedSectionStatus({ is_active: false, starts_at: "2020-01-01T00:00:00Z", ends_at: "2099-01-01T00:00:00Z" }, NOW)
    ).toBe("inactive");
  });
  it("antes de starts_at → scheduled; después de ends_at → expired", () => {
    expect(getFeaturedSectionStatus({ is_active: true, starts_at: "2026-11-01T00:00:00Z", ends_at: null }, NOW)).toBe("scheduled");
    expect(getFeaturedSectionStatus({ is_active: true, starts_at: null, ends_at: "2026-09-01T00:00:00Z" }, NOW)).toBe("expired");
  });
  it("las fechas son independientes: sólo inicio o sólo fin también funcionan", () => {
    expect(getFeaturedSectionStatus({ is_active: true, starts_at: "2026-09-01T00:00:00Z", ends_at: null }, NOW)).toBe("live");
    expect(getFeaturedSectionStatus({ is_active: true, starts_at: null, ends_at: "2026-12-01T00:00:00Z" }, NOW)).toBe("live");
  });
  it("dentro de la ventana → live", () => {
    expect(
      getFeaturedSectionStatus({ is_active: true, starts_at: "2026-09-15T00:00:00Z", ends_at: "2026-10-18T00:00:00Z" }, NOW)
    ).toBe("live");
  });
});

describe("resolveFeaturedSections", () => {
  it("sin secciones → [] (el catálogo queda exactamente como hoy)", () => {
    expect(resolveFeaturedSections([], catalog, NOW)).toEqual([]);
  });

  it("sólo muestra secciones vigentes", () => {
    const rows = [
      section({ id: "viva", productIds: ["a"] }),
      section({ id: "inactiva", is_active: false, productIds: ["a"] }),
      section({ id: "futura", starts_at: "2027-01-01T00:00:00Z", productIds: ["a"] }),
      section({ id: "vencida", ends_at: "2025-01-01T00:00:00Z", productIds: ["a"] }),
    ];
    expect(resolveFeaturedSections(rows, catalog, NOW).map((s) => s.id)).toEqual(["viva"]);
  });

  it("ordena las secciones por sort_order (no está hardcodeado ninguna campaña)", () => {
    const rows = [
      section({ id: "tres", sort_order: 2, productIds: ["a"] }),
      section({ id: "uno", sort_order: 0, productIds: ["a"] }),
      section({ id: "dos", sort_order: 1, productIds: ["a"] }),
    ];
    expect(resolveFeaturedSections(rows, catalog, NOW).map((s) => s.id)).toEqual(["uno", "dos", "tres"]);
  });

  it("ordena los productos de cada sección por su sort_order", () => {
    const row = section({ id: "s" });
    row.wholesale_featured_section_products = [
      { product_id: "c", sort_order: 2 },
      { product_id: "a", sort_order: 0 },
      { product_id: "b", sort_order: 1 },
    ];
    expect(resolveFeaturedSections([row], catalog, NOW)[0].products.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("un producto que no está en el catálogo visible (oculto, inactivo, sin precio…) no aparece, y no rompe el resto", () => {
    const rows = [section({ id: "s", productIds: ["a", "oculto", "b"] })];
    expect(resolveFeaturedSections(rows, catalog, NOW)[0].products.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("una sección sin ningún producto visible no se muestra", () => {
    const rows = [section({ id: "vacia", productIds: ["oculto1", "oculto2"] }), section({ id: "sin-productos" })];
    expect(resolveFeaturedSections(rows, catalog, NOW)).toEqual([]);
  });

  it("no muta las filas de entrada", () => {
    const rows = [section({ id: "s", productIds: ["b", "a"] })];
    const snapshot = JSON.stringify(rows);
    resolveFeaturedSections(rows, catalog, NOW);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

describe("si la tabla no existe todavía (migración sin aplicar en ese entorno)", () => {
  // Un fallo de esta lectura NUNCA puede romper /mayorista: el catálogo
  // tiene que verse exactamente como sin secciones.
  const failing = {
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order"]) b[m] = () => b;
      b.then = (resolve: (v: unknown) => void) =>
        Promise.resolve({ data: null, error: { code: "42P01", message: 'relation "wholesale_featured_sections" does not exist' } }).then(resolve);
      return b;
    },
  } as unknown as SupabaseClient;

  it("fetchFeaturedSectionRows devuelve [] en vez de lanzar", async () => {
    await expect(fetchFeaturedSectionRows(failing)).resolves.toEqual([]);
  });

  it("fetchFeaturedSectionsAdmin devuelve [] en vez de lanzar", async () => {
    await expect(fetchFeaturedSectionsAdmin(failing)).resolves.toEqual([]);
  });
});
