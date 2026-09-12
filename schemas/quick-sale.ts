import { z } from "zod";
import { optionalUuid } from "@/lib/zod-helpers";

// Venta minorista rápida — a propósito NO incluye unit_price acá: el
// precio real lo resuelve el RPC (create_quick_retail_sale) contra
// price_list_items, nunca el que mande el cliente. expected_unit_price
// viaja sólo para el chequeo de "¿cambió el precio desde que se abrió la
// pantalla?" en el Server Action, antes de llamar al RPC — no es lo que
// se guarda ni lo que decide el cobro.
export const quickSaleItemSchema = z.object({
  product_variant_id: z.string().trim().uuid(),
  quantity: z.number().int().positive(),
  expected_unit_price: z.number().nonnegative(),
});

export type QuickSaleItemInput = z.infer<typeof quickSaleItemSchema>;

export const quickSaleSchema = z.object({
  location_id: z.string().trim().uuid("Elegí una ubicación."),
  payment_method_id: z.string().trim().uuid("Elegí una forma de pago."),
  payment_account_id: optionalUuid(),
  // Mismo contrato ya establecido para paid_at en el resto de la app:
  // siempre explícito, nunca un atajo "si es hoy, se omite" — el action
  // arma el timestamptz real vía dateOnlyToArgentinaNoonISO.
  paid_at: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  customer_id: optionalUuid(),
  channel_id: optionalUuid(),
  client_request_id: z.string().trim().uuid(),
  items: z.array(quickSaleItemSchema).min(1, "Agregá al menos un producto."),
  // Condición de precio elegida (Bloque 3) — nunca opcional: cada venta
  // se cotiza y se cobra bajo una condición específica.
  price_condition_id: z.string().trim().uuid("Elegí una condición de precio."),
  // Sólo para el chequeo de "¿cambió la cotización desde que se mostró
  // la card?" en el Server Action — no es lo que decide el cobro, eso lo
  // vuelve a resolver create_quick_retail_sale server-side.
  expected_total: z.number().nonnegative(),
});

export type QuickSaleInput = z.infer<typeof quickSaleSchema>;
