import { z } from "zod";

const optionalUuid = z
  .string()
  .trim()
  .uuid()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

export const orderItemInputSchema = z.object({
  product_variant_id: z.string().trim().uuid(),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
});

export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

export const createOrderSchema = z.object({
  business_unit_id: z.string().trim().uuid(),
  customer_id: z.string().trim().uuid(),
  location_id: optionalUuid,
  origin_channel_id: optionalUuid,
  closing_channel_id: optionalUuid,
  delivery_method: z
    .enum(["pickup", "shipping", "other"])
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  delivery_address: z
    .string()
    .trim()
    .max(300)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  estimated_date: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  items: z.array(orderItemInputSchema).min(1, "Agregá al menos un producto."),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const paymentSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Requerido")
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v > 0, "Importe inválido"),
  // Siempre explícito — nunca un atajo "si es hoy, se omite y cae el
  // default now()". created_at = cuándo se cargó en Pottery; paid_at =
  // cuándo pasó el pago de verdad (docs/business-rules.md § Argentina,
  // moneda y horario). El action arma el timestamptz real desde esta
  // fecha vía dateOnlyToArgentinaNoonISO.
  paid_at: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  method_id: z
    .string()
    .trim()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  account_id: z
    .string()
    .trim()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  reference: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
});

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  in_production: "En producción",
  ready: "Listo para entregar",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as (keyof typeof ORDER_STATUS_LABELS)[];
