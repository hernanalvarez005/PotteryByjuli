"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { renderWholesaleOrderPdf } from "@/lib/wholesale-pdf";
import { renderOrderPdf } from "@/lib/order-pdf";
import { customerDisplayName } from "@/lib/customers-shared";
import { loadWholesaleOrderForDocument, storeWholesaleOrderPdf, WholesalePdfStepError } from "@/lib/wholesale-pdf-store";
import { logWholesalePdf } from "@/lib/wholesale-pdf-log";

const ORDER_ATTACHMENTS_BUCKET = "order-attachments";

/**
 * Staff-side signed URL for a stored wholesale document — deliberately
 * short-lived (60s, just long enough to open/download once) and minted with
 * the current user's own authenticated session, never the service role:
 * `order_attachments_staff_read` already grants any authenticated user
 * select on this bucket, so there's nothing here anon can't already be
 * blocked from that needs elevated privileges.
 */
export async function getWholesaleDocumentSignedUrl(storagePath: string): Promise<string | null> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(ORDER_ATTACHMENTS_BUCKET).createSignedUrl(storagePath, 60);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Genera (o REGENERA) el PDF de una solicitud del checkout mayorista.
 * Es seguro repetirlo tantas veces como haga falta: reusa la misma ruta
 * de Storage (`{orderId}/{humanCode}.pdf`, con upsert) y la única fila
 * `order_attachments` del pedido — nunca duplica archivos ni referencias,
 * y no toca pedido, pagos, items ni historial. Recupera los cuatro estados
 * DB/Storage: normal, archivo huérfano, fila huérfana y ninguno.
 *
 * Lee sólo lo congelado al momento del pedido (`wholesale_buyer_snapshot`,
 * `wholesale_terms_snapshot`, `order_items.unit_price`), así que el
 * documento regenerado representa la solicitud original — ver
 * docs/business-rules.md. Un pedido cargado a mano (sin snapshot) no
 * proviene del checkout y no tiene datos para armarlo.
 *
 * Cada etapa tiene su propio try/catch: la usuaria recibe un mensaje
 * específico y queda un log estructurado con humanCode, orderId y etapa.
 */
export async function generateWholesaleDocumentForOrder(orderId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    return { error: "No tenés permiso para generar este documento." };
  }

  const started = Date.now();
  const supabase = await createClient();

  // 1) load_order
  let loaded;
  try {
    loaded = await loadWholesaleOrderForDocument(supabase, { orderId });
  } catch (error) {
    logWholesalePdf("wholesale_pdf_failed", { humanCode: "?", orderId, step: "load_order", source: "backoffice", elapsedMs: Date.now() - started, error });
    return { error: "No se pudo leer el pedido. Probá de nuevo." };
  }
  if (!loaded.ok) {
    logWholesalePdf("wholesale_pdf_failed", {
      humanCode: loaded.humanCode ?? "?",
      orderId,
      step: "load_order",
      reason: loaded.reason,
      source: "backoffice",
      elapsedMs: Date.now() - started,
      error: loaded.detail,
    });
    if (loaded.reason === "snapshot_incomplete") {
      return { error: "Este pedido no proviene del checkout mayorista, así que no hay datos de solicitud para armar el PDF." };
    }
    if (loaded.reason === "not_found") return { error: "No encontramos el pedido." };
    return { error: "No se pudo leer el pedido. Probá de nuevo." };
  }
  const order = loaded.order;

  // 2) render
  let pdfBytes: Buffer;
  try {
    pdfBytes = await renderWholesaleOrderPdf({
      humanCode: order.humanCode,
      createdAt: new Date(order.createdAt),
      buyer: order.buyer,
      terms: order.terms,
      items: order.items,
    });
  } catch (error) {
    logWholesalePdf("wholesale_pdf_failed", { humanCode: order.humanCode, orderId, step: "render", source: "backoffice", elapsedMs: Date.now() - started, error });
    return { error: "No se pudo armar el PDF (falló la generación del documento)." };
  }

  // 3) upload + 4) attachment_insert (idempotente)
  try {
    await storeWholesaleOrderPdf(supabase, { orderId: order.orderId, humanCode: order.humanCode, pdfBytes, uploadedBy: user.id });
  } catch (error) {
    const step = error instanceof WholesalePdfStepError ? error.step : "upload";
    logWholesalePdf("wholesale_pdf_failed", { humanCode: order.humanCode, orderId, step, source: "backoffice", elapsedMs: Date.now() - started, error });
    return {
      error:
        step === "attachment_insert"
          ? "El PDF se generó pero no se pudo registrar en el pedido. Volvé a intentar: es seguro repetirlo."
          : "No se pudo guardar el PDF. Volvé a intentar: es seguro repetirlo.",
    };
  }

  logWholesalePdf("wholesale_pdf_generated", { humanCode: order.humanCode, orderId, source: "backoffice", elapsedMs: Date.now() - started });
  revalidatePath(`/pedidos/${orderId}`);
  revalidatePath("/pedidos");
  return {};
}

/**
 * "Resumen PDF del pedido" (order_summary_pdf) — sección 10/11 de la
 * tanda de usabilidad. Reusa el renderer/branding/bucket privado/signed
 * URL ya construidos para el PDF mayorista (wholesale_request_pdf) —
 * mismo `order_attachments`, sólo un `kind` distinto. A diferencia de
 * ese, no requiere ningún snapshot especial: `order_items.unit_price` ya
 * es histórico (nunca se vuelve a consultar price_list_items), y
 * `payments` es la fuente de verdad de lo cobrado — nunca se recalculan
 * precios/condiciones actuales del catálogo acá.
 */
export async function generateOrderSummaryPdf(orderId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    return { error: "No tenés permiso para generar este documento." };
  }

  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, human_code, created_at, estimated_date, notes, customers(first_name,last_name), order_items(quantity,unit_price,custom_name,custom_description,product_variants(name,products(name))), payments(amount,paid_at,payment_methods(name))"
    )
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return { error: "No se pudo leer el pedido." };
  }

  const customer = order.customers as unknown as { first_name: string; last_name: string | null } | null;

  const items = (
    order.order_items as unknown as {
      quantity: number;
      unit_price: number;
      custom_name: string | null;
      custom_description: string | null;
      product_variants: { name: string; products: { name: string } } | null;
    }[]
  ).map((item) => {
    const variant = item.product_variants;
    const label = variant
      ? variant.name === "Único"
        ? variant.products.name
        : `${variant.products.name} — ${variant.name}`
      : (item.custom_name ?? "—");
    return {
      label,
      note: !variant ? item.custom_description : null,
      quantity: item.quantity,
      unitPrice: item.unit_price,
    };
  });

  const payments = (
    order.payments as unknown as { amount: number; paid_at: string; payment_methods: { name: string } | null }[]
  ).map((p) => ({ amount: p.amount, paidAt: new Date(p.paid_at), methodName: p.payment_methods?.name ?? null }));

  const pdfBytes = await renderOrderPdf({
    humanCode: order.human_code,
    createdAt: new Date(order.created_at),
    customerName: customer ? customerDisplayName(customer) : null,
    items,
    payments,
    estimatedDate: order.estimated_date ? new Date(order.estimated_date) : null,
    notes: order.notes,
  });

  const storagePath = `${order.id}/${order.human_code}-resumen.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(ORDER_ATTACHMENTS_BUCKET)
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    return { error: "No se pudo subir el documento." };
  }

  // upsert=true a propósito acá (a diferencia del mayorista, que nunca
  // reescribe "la solicitud original"): este resumen sí puede
  // regenerarse cuando el pedido cambia (nuevo pago, ítem agregado) —
  // por eso el insert de abajo también reemplaza el registro anterior de
  // este `kind` en vez de acumular filas viejas.
  await supabase.from("order_attachments").delete().eq("order_id", order.id).eq("kind", "order_summary_pdf");
  const { error: insertError } = await supabase
    .from("order_attachments")
    .insert({ order_id: order.id, storage_path: storagePath, kind: "order_summary_pdf", uploaded_by: user.id });

  if (insertError) {
    return { error: "El documento se subió pero no se pudo registrar." };
  }

  revalidatePath(`/pedidos/${orderId}`);
  return {};
}
