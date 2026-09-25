import { renderWholesaleOrderPdf } from "@/lib/wholesale-pdf";
import {
  getWholesaleOrderForDocument,
  uploadWholesaleOrderPdf,
  createWholesalePdfSignedUrl,
} from "@/lib/supabase/admin-server-only";
import { WholesalePdfStepError, type WholesalePdfStep } from "@/lib/wholesale-pdf-store";
import { logWholesalePdf } from "@/lib/wholesale-pdf-log";

/**
 * Genera y guarda el PDF de una solicitud mayorista YA creada (el pedido
 * está a salvo: lo resolvió la transacción de submit_wholesale_request).
 * Todo esto es "mejor esfuerzo" y NUNCA lanza ni hace fallar el checkout:
 * si algo sale mal devuelve `documentUrl: null` — pero cada falla queda en
 * un log estructurado con la etapa, el código del pedido y su id.
 *
 * Etapas: load_order → render → upload → attachment_insert → signed_url.
 * Distingue dos situaciones que NO son lo mismo:
 * - `wholesale_pdf_failed`: no hay PDF (falló la etapa X);
 * - `wholesale_pdf_link_unavailable`: el PDF SÍ existe, pero no se pudo
 *   firmar el link temporal.
 *
 * Sin reintentos automáticos a propósito (podrían empeorar timeouts y
 * duración de la función); la recuperación es la regeneración idempotente
 * desde el backoffice.
 */
export async function generateCheckoutPdf(humanCode: string): Promise<{ orderId?: string; documentUrl: string | null }> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  let orderId: string | undefined;

  const fail = (step: WholesalePdfStep, error: unknown, extra: { reason?: string } = {}) => {
    logWholesalePdf("wholesale_pdf_failed", { humanCode, orderId, step, source: "checkout", elapsedMs: elapsed(), error, ...extra });
    return { orderId, documentUrl: null as string | null };
  };

  logWholesalePdf("wholesale_pdf_started", { humanCode, source: "checkout" });

  // 1) load_order
  let loaded;
  try {
    loaded = await getWholesaleOrderForDocument(humanCode);
  } catch (error) {
    return fail("load_order", error);
  }
  if (!loaded.ok) {
    orderId = loaded.orderId;
    return fail("load_order", loaded.detail, { reason: loaded.reason });
  }
  const order = loaded.order;
  orderId = order.orderId;

  // 2) render
  let pdfBytes: Buffer;
  try {
    pdfBytes = await renderWholesaleOrderPdf({
      humanCode: order.humanCode,
      createdAt: new Date(order.createdAt),
      buyer: order.buyer,
      items: order.items,
      terms: order.terms,
    });
  } catch (error) {
    return fail("render", error);
  }

  // 3) upload + 4) attachment_insert
  let storagePath: string;
  try {
    storagePath = await uploadWholesaleOrderPdf(order.orderId, order.humanCode, pdfBytes);
  } catch (error) {
    return fail(error instanceof WholesalePdfStepError ? error.step : "upload", error);
  }

  // El PDF ya existe y está registrado. Desde acá, un problema con el link
  // NO es "PDF fallido".
  logWholesalePdf("wholesale_pdf_generated", { humanCode, orderId, source: "checkout", elapsedMs: elapsed() });

  // 5) signed_url
  try {
    const signed = await createWholesalePdfSignedUrl(storagePath);
    if (signed.ok) return { orderId, documentUrl: signed.url };
    logWholesalePdf("wholesale_pdf_link_unavailable", { humanCode, orderId, step: "signed_url", source: "checkout", elapsedMs: elapsed(), error: signed.error });
  } catch (error) {
    logWholesalePdf("wholesale_pdf_link_unavailable", { humanCode, orderId, step: "signed_url", source: "checkout", elapsedMs: elapsed(), error });
  }
  return { orderId, documentUrl: null };
}
