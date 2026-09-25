import { describe, it, expect } from "vitest";
import { featuredSectionSchema, MAX_FEATURED_PRODUCTS } from "./wholesale-featured";

const UUID = "11111111-1111-4111-8111-111111111111";
const base = {
  id: null,
  title: "Día de la Madre",
  description: null,
  is_active: "true",
  starts_on: null,
  ends_on: null,
  product_ids: [UUID],
};

describe("featuredSectionSchema", () => {
  it("acepta una sección mínima: sin descripción ni fechas (null explícito, como llega de FormData)", () => {
    const parsed = featuredSectionSchema.parse(base);
    expect(parsed).toMatchObject({ title: "Día de la Madre", description: null, starts_on: null, ends_on: null, is_active: true });
  });

  it("las fechas vacías ('') y ausentes son lo mismo que null", () => {
    expect(featuredSectionSchema.parse({ ...base, starts_on: "", ends_on: undefined })).toMatchObject({ starts_on: null, ends_on: null });
  });

  it("acepta fechas válidas y la misma fecha de inicio y fin", () => {
    expect(featuredSectionSchema.safeParse({ ...base, starts_on: "2026-09-15", ends_on: "2026-10-18" }).success).toBe(true);
    expect(featuredSectionSchema.safeParse({ ...base, starts_on: "2026-10-18", ends_on: "2026-10-18" }).success).toBe(true);
  });

  it("rechaza fin anterior al inicio, con mensaje propio", () => {
    const r = featuredSectionSchema.safeParse({ ...base, starts_on: "2026-10-18", ends_on: "2026-09-15" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/fecha de fin/i);
  });

  it("rechaza fechas con formato inválido", () => {
    expect(featuredSectionSchema.safeParse({ ...base, starts_on: "15/09/2026" }).success).toBe(false);
    expect(featuredSectionSchema.safeParse({ ...base, ends_on: "2026-13-45" }).success).toBe(false);
  });

  it("el nombre es obligatorio (null/'' fallan con el mensaje propio) y tiene tope", () => {
    for (const title of [null, "", "   "]) {
      const r = featuredSectionSchema.safeParse({ ...base, title });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe("Falta el nombre de la sección.");
    }
    expect(featuredSectionSchema.safeParse({ ...base, title: "x".repeat(81) }).success).toBe(false);
  });

  it("is_active sólo acepta 'true'/'false'", () => {
    expect(featuredSectionSchema.parse({ ...base, is_active: "false" }).is_active).toBe(false);
    expect(featuredSectionSchema.safeParse({ ...base, is_active: "on" }).success).toBe(false);
  });

  it("valida los ids de producto y el máximo", () => {
    expect(featuredSectionSchema.safeParse({ ...base, product_ids: ["no-es-uuid"] }).success).toBe(false);
    expect(featuredSectionSchema.safeParse({ ...base, product_ids: Array(MAX_FEATURED_PRODUCTS + 1).fill(UUID) }).success).toBe(false);
    expect(featuredSectionSchema.safeParse({ ...base, product_ids: [] }).success).toBe(true); // una sección puede quedar sin productos
  });
});
