import { dateOnlyToArgentinaNoonISO } from "@/lib/format";

/** Lo que `paymentSchema` devuelve ya validado (la fecha sigue siendo YYYY-MM-DD). */
type ParsedPayment = {
  amount: number;
  paid_at: string;
  method_id: string | null;
  account_id: string | null;
  reference: string | null;
  notes: string | null;
  fee_amount: number;
};

/**
 * Fila a insertar en `payments` para un pago nuevo de un pedido. Lista EXPLÍCITA de columnas:
 * `paymentSchema` también lleva campos que NO son columnas de `payments` (p. ej. `reason`, el
 * motivo de una corrección, que vive en `payment_corrections`). Un `{ ...parsed.data }` los
 * mandaría al INSERT y PostgREST rechazaría el pago entero ("column reason does not exist").
 */
export function buildOrderPaymentInsert(parsed: ParsedPayment, orderId: string, userId: string) {
  return {
    order_id: orderId,
    amount: parsed.amount,
    paid_at: dateOnlyToArgentinaNoonISO(parsed.paid_at),
    method_id: parsed.method_id,
    account_id: parsed.account_id,
    reference: parsed.reference,
    notes: parsed.notes,
    fee_amount: parsed.fee_amount,
    created_by: userId,
  };
}
