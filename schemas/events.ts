import { z } from "zod";

const optionalMoney = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? Number(v) : null))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Importe inválido");

export const eventSchema = z.object({
  event_type: z.enum(["workshop", "fair"]),
  name: z.string().trim().min(1, "Requerido").max(160),
  location_id: z
    .string()
    .trim()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  event_date: z.string().trim().min(1, "Requerido"),
  schedule: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  capacity: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v > 0), "Cupo inválido"),
  price: optionalMoney,
  cost_estimate: optionalMoney,
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
});

export const registrationSchema = z.object({
  customer_id: z.string().trim().uuid(),
  quantity: z
    .string()
    .trim()
    .min(1)
    .transform((v) => Number(v))
    .refine((v) => Number.isInteger(v) && v > 0, "Cantidad inválida"),
});

export const EVENT_STATUS_LABELS: Record<string, string> = {
  planned: "Planificado",
  confirmed: "Confirmado",
  completed: "Realizado",
  cancelled: "Cancelado",
};
