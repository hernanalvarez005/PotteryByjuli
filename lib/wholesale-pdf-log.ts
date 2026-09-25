import type { WholesalePdfStep } from "@/lib/wholesale-pdf-store";

// Logs estructurados del pipeline del PDF mayorista. Una línea JSON por
// evento, fácil de buscar en los logs de runtime (`wholesale_pdf_failed`).
//
// Existe porque el incidente de MAY-000024 (PDF automático ausente,
// regenerado a mano ~2 h después) no se pudo diagnosticar: los errores
// post-commit sólo dejaban un console.error sin contexto, o nada.
//
// NUNCA se loguean datos del comprador (nombre, email, WhatsApp, CUIT,
// dirección…): sólo identificadores del pedido, la etapa y el error.

export type WholesalePdfLogEvent =
  /** Arrancó la generación. Un `started` sin `generated`/`failed` posterior
   * en el mismo pedido indica que la función se cortó (timeout). */
  | "wholesale_pdf_started"
  /** PDF generado Y registrado (archivo + fila). */
  | "wholesale_pdf_generated"
  /** No hay PDF: falló la etapa `step`. */
  | "wholesale_pdf_failed"
  /** El PDF SÍ existe pero no se pudo firmar el link temporal. */
  | "wholesale_pdf_link_unavailable";

export type WholesalePdfLogFields = {
  humanCode: string;
  orderId?: string | null;
  step?: WholesalePdfStep;
  /** De dónde se disparó: el checkout público o el backoffice. */
  source?: "checkout" | "backoffice";
  /** Para `load_order`: not_found | snapshot_incomplete | query_error |
   * not_wholesale | missing_customer. */
  reason?: string;
  /** `request` (solicitud del checkout) u `order` (pedido cargado a mano). */
  documentKind?: "request" | "order";
  elapsedMs?: number;
  error?: unknown;
};

const MAX_ERROR_LENGTH = 300;

function describeError(error: unknown): { errorName?: string; errorMessage?: string; errorCode?: string } {
  if (error === undefined || error === null) return {};
  if (typeof error === "string") return { errorMessage: error.slice(0, MAX_ERROR_LENGTH) };
  if (typeof error === "object") {
    const e = error as { name?: unknown; message?: unknown; code?: unknown };
    return {
      errorName: typeof e.name === "string" ? e.name : undefined,
      errorMessage: typeof e.message === "string" ? e.message.slice(0, MAX_ERROR_LENGTH) : undefined,
      errorCode: typeof e.code === "string" ? e.code : undefined,
    };
  }
  return { errorMessage: String(error).slice(0, MAX_ERROR_LENGTH) };
}

export function logWholesalePdf(event: WholesalePdfLogEvent, fields: WholesalePdfLogFields): void {
  const { error, ...rest } = fields;
  const line = JSON.stringify({ event, ...rest, ...describeError(error) });
  if (event === "wholesale_pdf_failed") console.error(line);
  else if (event === "wholesale_pdf_link_unavailable") console.warn(line);
  else console.info(line);
}
