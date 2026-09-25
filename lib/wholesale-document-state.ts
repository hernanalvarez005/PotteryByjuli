import type { SupabaseClient } from "@supabase/supabase-js";
import { WHOLESALE_PDF_KIND } from "@/lib/wholesale-pdf-store";

// Estado del documento de una solicitud mayorista, DERIVADO (sin columna
// `pdf_status`): "originado en el checkout" = wholesale_buyer_snapshot no
// es null (lo escribe sólo submit_wholesale_request); "tiene PDF" = existe
// una fila order_attachments kind='wholesale_request_pdf'.
//
// A propósito NO se usa la unidad de negocio Mayorista: un pedido cargado
// a mano en esa unidad nunca tuvo un intento automático de PDF, así que
// marcarlo como "sin PDF" o "falló" sería falso (ni aparece la señal "Sin
// PDF" en el listado). Igual se puede generar a pedido desde su ficha.

export type WholesaleDocumentState =
  /** Hay PDF (ver / regenerar). */
  | "pdf_available"
  /** Vino del checkout y no tiene PDF: hay que generarlo. */
  | "pdf_missing"
  /** No vino del checkout (pedido cargado a mano): nunca hubo intento
   * automático; el PDF se genera a pedido desde la ficha. */
  | "not_from_checkout";

export function getWholesaleDocumentState(input: { hasPdf: boolean; checkoutOrigin: boolean }): WholesaleDocumentState {
  if (input.hasPdf) return "pdf_available";
  return input.checkoutOrigin ? "pdf_missing" : "not_from_checkout";
}

export const WHOLESALE_DOCUMENT_COPY = {
  pdf_missing: "No se generó el PDF de esta solicitud.",
  not_from_checkout: "Todavía no se generó el PDF de este pedido.",
} as const;

const CHUNK = 100;

/**
 * Para los `orderIds` dados (siempre una página/tablero acotado, nunca la
 * tabla entera), devuelve sólo los que se originaron en el checkout
 * mayorista y si ya tienen PDF. Una sola query embebida por tanda.
 */
export async function getWholesalePdfStates(
  supabase: SupabaseClient,
  orderIds: string[]
): Promise<Map<string, { hasPdf: boolean }>> {
  const states = new Map<string, { hasPdf: boolean }>();

  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const ids = orderIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("orders")
      .select("id, order_attachments(kind)")
      .in("id", ids)
      .not("wholesale_buyer_snapshot", "is", null);
    if (error) {
      // Un indicador operativo nunca debe romper la pantalla: sin datos, no
      // se marca nada — pero tampoco se traga en silencio.
      console.error(JSON.stringify({ event: "wholesale_pdf_state_query_failed", errorCode: error.code, errorMessage: error.message }));
      continue;
    }
    for (const row of (data ?? []) as unknown as { id: string; order_attachments: { kind: string | null }[] }[]) {
      states.set(row.id, { hasPdf: row.order_attachments.some((a) => a.kind === WHOLESALE_PDF_KIND) });
    }
  }
  return states;
}

/** Ids de pedidos del checkout mayorista que todavía no tienen PDF. */
export async function getMissingWholesalePdfOrderIds(supabase: SupabaseClient, orderIds: string[]): Promise<Set<string>> {
  const states = await getWholesalePdfStates(supabase, orderIds);
  return new Set([...states].filter(([, s]) => !s.hasPdf).map(([id]) => id));
}
