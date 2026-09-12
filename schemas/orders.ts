import { z } from "zod";
import { optionalString, optionalUuid, optionalMoneyAmount } from "@/lib/zod-helpers";

// Un pedido puede tener ítems de catálogo (con product_variant_id real) o
// ítems no inventariados/personalizados (custom_name en vez de una
// variante) — nunca los dos a la vez, nunca ninguno de los dos (sección 8
// de la tanda de usabilidad). Nunca se descuenta stock automáticamente
// por un ítem custom (ver supabase/migrations/*_order_items_custom_non_stock.sql)
// ni se crea un producto permanente en /productos.
const catalogOrderItemSchema = z.object({
  product_variant_id: z.string().trim().uuid(),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
});

const customOrderItemSchema = z.object({
  custom_name: z.string().trim().min(1, "Falta el nombre del ítem.").max(200),
  custom_description: optionalString(1000),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
});

export const orderItemInputSchema = z.union([catalogOrderItemSchema, customOrderItemSchema]);

export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

// delivery_method/delivery_address use the same null-safe preprocessing as
// optionalString/optionalUuid (lib/zod-helpers.ts) — delivery_address in
// particular is only rendered in the form when delivery_method is
// "shipping" (order-form.tsx), so formData.get("delivery_address") is a
// bare `null`, not `""`, whenever "Retiro"/"Otro" is picked. The old
// `.optional().or(z.literal(""))` pattern doesn't tolerate that bare
// `null` and fails with Zod's generic "Invalid input" — which is exactly
// what broke order creation in production for every non-shipping order
// (2026-09-10, found via a real user report).
const optionalDeliveryMethod = z
  .preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.enum(["pickup", "shipping", "other"]).optional()
  )
  .transform((v) => v ?? null);

export const createOrderSchema = z.object({
  business_unit_id: z.string().trim().uuid(),
  customer_id: z.string().trim().uuid(),
  location_id: optionalUuid(),
  origin_channel_id: optionalUuid(),
  closing_channel_id: optionalUuid(),
  delivery_method: optionalDeliveryMethod,
  delivery_address: optionalString(300),
  estimated_date: optionalString(10),
  notes: optionalString(2000),
  items: z.array(orderItemInputSchema).min(1, "Agregá al menos un producto."),
  // Pago opcional al crear el pedido (sección 3 de la tanda de
  // usabilidad) — nunca obligatorio. Un checkbox ausente del FormData es
  // `null`, nunca "on"/"off", así que el preprocess lo trata como false
  // en vez de fallar.
  register_payment: z.preprocess((v) => v === "on", z.boolean()),
  payment_amount: optionalMoneyAmount(),
  payment_method_id: optionalUuid(),
  payment_account_id: optionalUuid(),
  payment_paid_at: optionalString(10),
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
  method_id: optionalUuid(),
  account_id: optionalUuid(),
  reference: optionalString(120),
  notes: optionalString(500),
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
