import { z } from "zod";

export const productSchema = z.object({
  name: z.string().trim().min(1, "Requerido").max(120),
  category_id: z
    .string()
    .trim()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  cost_estimate: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), {
      message: "El costo tiene que ser un número positivo.",
    }),
});

export type ProductInput = z.infer<typeof productSchema>;

export const categorySchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Requerido")
    .max(40)
    .regex(/^[a-z0-9_-]+$/, "Usá minúsculas, números, - o _"),
  name: z.string().trim().min(1, "Requerido").max(80),
});

export const variantSchema = z.object({
  name: z.string().trim().min(1, "Requerido").max(80),
  sku: z
    .string()
    .trim()
    .max(60)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
});

export const priceSchema = z.object({
  price_list_id: z.string().trim().uuid(),
  product_variant_id: z.string().trim().uuid(),
  unit_price: z
    .string()
    .trim()
    .min(1, "Requerido")
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v >= 0, "Precio inválido"),
});

// Precio mayorista para todas las variantes de un producto de un saque
// (sección 4 de la tanda de mejoras operativas). A propósito no incluye
// price_list_id ni product_variant_id — el server action los resuelve
// enteramente del lado del servidor, nunca confía en ids que mande el
// cliente.
export const bulkWholesalePriceSchema = z.object({
  unit_price: z
    .string()
    .trim()
    .min(1, "Requerido")
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v >= 0, "Precio inválido"),
});
