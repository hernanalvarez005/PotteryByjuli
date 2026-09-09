import { z } from "zod";

export const PRODUCTION_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  modeling: "Modelado",
  drying: "Secado",
  first_firing: "1ª cocción",
  glazing: "Esmaltado",
  second_firing: "2ª cocción",
  quality_check: "Control",
  done: "Terminado",
  cancelled: "Cancelado",
};

/** Linear path a card moves through with the "Avanzar" button. */
export const PRODUCTION_STAGE_ORDER = [
  "pending",
  "modeling",
  "drying",
  "first_firing",
  "glazing",
  "second_firing",
  "quality_check",
] as const;

export const PRODUCTION_ORIGIN_LABELS: Record<string, string> = {
  restock: "Reposición",
  retail_order: "Pedido minorista",
  wholesale_order: "Pedido mayorista",
  custom_order: "Personalizado",
  workshop: "Taller",
  fair: "Feria",
};

export const newProductionOrderSchema = z.object({
  product_variant_id: z.string().trim().uuid(),
  location_id: z.string().trim().uuid(),
  quantity: z
    .string()
    .trim()
    .min(1, "Requerido")
    .transform((v) => Number(v))
    .refine((v) => Number.isInteger(v) && v > 0, "Cantidad inválida"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  target_date: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
});

export const completeProductionSchema = z.object({
  produced_quantity: z
    .string()
    .trim()
    .transform((v) => Number(v))
    .refine((v) => Number.isInteger(v) && v >= 0, "Cantidad inválida"),
  rejected_quantity: z
    .string()
    .trim()
    .transform((v) => Number(v))
    .refine((v) => Number.isInteger(v) && v >= 0, "Cantidad inválida"),
});
