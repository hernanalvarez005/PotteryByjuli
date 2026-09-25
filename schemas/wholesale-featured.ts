import { z } from "zod";
import { optionalString, optionalUuid, requiredString } from "@/lib/zod-helpers";

// Alta/edición de una sección destacada del catálogo mayorista. Las fechas
// son opcionales y llegan como día calendario (YYYY-MM-DD, hora argentina);
// el Server Action las convierte a timestamptz (inicio / fin de día).

const optionalDate = () =>
  z
    .preprocess(
      (v) => (v === null || v === undefined || v === "" ? undefined : v),
      z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.")
        .refine((s) => !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime()), "Fecha inválida.")
        .optional()
    )
    .transform((v) => v ?? null);

export const MAX_FEATURED_PRODUCTS = 50;

export const featuredSectionSchema = z
  .object({
    id: optionalUuid(),
    title: requiredString(z.string().trim().min(1, "Falta el nombre de la sección.").max(80, "El nombre es muy largo (máx. 80).")),
    description: optionalString(500),
    is_active: z.enum(["true", "false"]).transform((v) => v === "true"),
    starts_on: optionalDate(),
    ends_on: optionalDate(),
    product_ids: z
      .array(z.string().trim().uuid())
      .max(MAX_FEATURED_PRODUCTS, `Máximo ${MAX_FEATURED_PRODUCTS} productos por sección.`),
  })
  .refine((v) => !v.starts_on || !v.ends_on || v.starts_on <= v.ends_on, {
    message: "La fecha de fin no puede ser anterior a la de inicio.",
    path: ["ends_on"],
  });

export type FeaturedSectionInput = z.infer<typeof featuredSectionSchema>;
