import { z } from "zod";

export const adjustmentSchema = z.object({
  inventory_item_id: z.string().trim().uuid(),
  location_id: z.string().trim().uuid(),
  quantity: z
    .string()
    .trim()
    .min(1, "Requerido")
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v !== 0, "La cantidad no puede ser 0."),
  reason: z.string().trim().min(1, "Contá el motivo del ajuste."),
});

export const transferItemSchema = z.object({
  inventory_item_id: z.string().trim().uuid(),
  quantity: z.number().positive(),
});

export const createTransferSchema = z
  .object({
    from_location_id: z.string().trim().uuid(),
    to_location_id: z.string().trim().uuid(),
    notes: z
      .string()
      .trim()
      .max(500)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : null)),
    items: z.array(transferItemSchema).min(1, "Agregá al menos un producto."),
  })
  .refine((data) => data.from_location_id !== data.to_location_id, {
    message: "El origen y el destino tienen que ser distintos.",
    path: ["to_location_id"],
  });
