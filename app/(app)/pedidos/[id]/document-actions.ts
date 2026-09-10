"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { renderWholesaleOrderPdf, type WholesaleOrderPdfBuyer, type WholesaleOrderPdfTerms } from "@/lib/wholesale-pdf";

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
 * Generates the wholesale request PDF for an order that doesn't have one
 * yet (the original generation failed at checkout time — sección 41/42 del
 * brief). Only ever called when `order_attachments` has no row for this
 * order (the page gates the button on that) — never overwrites an existing
 * document, which would silently rewrite what the brief calls "la
 * solicitud original".
 *
 * Reads only what was frozen at request time (`wholesale_buyer_snapshot`,
 * `wholesale_terms_snapshot`, `order_items.unit_price`) — same historical
 * guarantee as the checkout's own PDF generation, see docs/business-rules.md.
 */
export async function generateWholesaleDocumentForOrder(orderId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    return { error: "No tenés permiso para generar este documento." };
  }

  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, human_code, created_at, wholesale_buyer_snapshot, wholesale_terms_snapshot, order_items(quantity, unit_price, product_variants(name, products(name)))"
    )
    .eq("id", orderId)
    .single();

  if (orderError || !order || !order.wholesale_buyer_snapshot || !order.wholesale_terms_snapshot) {
    return { error: "Este pedido no tiene los datos necesarios para generar el documento (no es una solicitud mayorista)." };
  }

  const items = (
    order.order_items as unknown as {
      quantity: number;
      unit_price: number;
      product_variants: { name: string; products: { name: string } } | null;
    }[]
  ).map((item) => ({
    productName: item.product_variants?.products.name ?? "",
    variantName: item.product_variants?.name ?? "",
    quantity: item.quantity,
    unitPrice: item.unit_price,
  }));

  const pdfBytes = await renderWholesaleOrderPdf({
    humanCode: order.human_code,
    createdAt: new Date(order.created_at),
    buyer: order.wholesale_buyer_snapshot as unknown as WholesaleOrderPdfBuyer,
    terms: order.wholesale_terms_snapshot as unknown as WholesaleOrderPdfTerms,
    items,
  });

  const storagePath = `${order.id}/${order.human_code}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(ORDER_ATTACHMENTS_BUCKET)
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    return { error: "No se pudo subir el documento." };
  }

  const { error: insertError } = await supabase
    .from("order_attachments")
    .insert({ order_id: order.id, storage_path: storagePath, kind: "wholesale_request_pdf", uploaded_by: user.id });

  if (insertError) {
    return { error: "El documento se subió pero no se pudo registrar." };
  }

  revalidatePath(`/pedidos/${orderId}`);
  return {};
}
