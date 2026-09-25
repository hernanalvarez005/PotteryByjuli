import { createClient } from "@supabase/supabase-js";
import {
  ORDER_ATTACHMENTS_BUCKET,
  loadWholesaleOrderForDocument,
  storeWholesaleOrderPdf,
  type LoadWholesaleOrderResult,
} from "@/lib/wholesale-pdf-store";

// Server-only. This is the ONE deliberate exception to the rule in
// scripts/_supabase-admin.ts ("nothing under app/ or lib/supabase/
// {client,server}.ts ever imports this file, so the service role key can
// never end up in a browser bundle — never a deployed/serverless
// context"). The wholesale checkout's Server Action runs as `anon` on
// purpose (no session — see docs/business-rules.md § Seguridad del portal
// mayorista público), but needs to do one narrow, trusted, server-side
// thing right after a real order was just created: upload its PDF to the
// private `order-attachments` bucket and mint a signed URL for it. That's
// exactly analogous to why `submit_wholesale_request` itself runs as
// `security definer` — anon can't do this directly, and shouldn't be
// granted a broader storage/table policy just to make this one operation
// possible.
//
// To keep the blast radius of that exception small, this module does NOT
// export the client itself (never `export const supabaseAdmin = ...`) —
// only the three narrow operations the wholesale checkout actually needs.
// If a new use case needs the service role, add a new named function here
// with the same care, don't reach for a raw client elsewhere.
//
// La lógica (leer el pedido, guardar el PDF de forma idempotente) vive en
// lib/wholesale-pdf-store.ts y es la MISMA que usa la regeneración desde el
// backoffice; acá sólo se le pasa el cliente con service role.
//
// Never import this file from a "use client" component.

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type { WholesaleOrderForDocument, LoadWholesaleOrderResult } from "@/lib/wholesale-pdf-store";

/**
 * Lee lo que el PDF necesita por el código legible del pedido. El Server
 * Action del checkout corre como `anon` (sin policy de select sobre
 * `orders`): esta es la única lectura, con service role, inmediatamente
 * después de que `submit_wholesale_request` resolvió (esa RPC sólo
 * devuelve `human_code`, a propósito).
 *
 * Devuelve un resultado EXPLÍCITO (`not_found` / `snapshot_incomplete` /
 * `query_error`), nunca un `null` mudo — el llamador loguea el motivo.
 * Lanza sólo si falta la configuración del entorno.
 */
export async function getWholesaleOrderForDocument(humanCode: string): Promise<LoadWholesaleOrderResult> {
  return loadWholesaleOrderForDocument(createAdminClient(), { humanCode });
}

/**
 * Sube el PDF a `order-attachments` en `{orderId}/{humanCode}.pdf` y
 * registra la única fila `order_attachments` (`wholesale_request_pdf`) del
 * pedido — idempotente: ver `storeWholesaleOrderPdf`. El UUID del pedido es
 * la barrera real de acceso; el código humano es sólo el nombre del archivo.
 */
export async function uploadWholesaleOrderPdf(orderId: string, humanCode: string, pdfBytes: Buffer): Promise<string> {
  return storeWholesaleOrderPdf(createAdminClient(), { orderId, humanCode, pdfBytes });
}

export type SignedUrlResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Link temporal (72 h por defecto: el que viaja en el WhatsApp del
 * comprador; documentado como tradeoff usabilidad/privacidad). Devuelve
 * el error en vez de `null`, para poder distinguir "el PDF existe pero el
 * link no está disponible" de "no hay PDF".
 */
export async function createWholesalePdfSignedUrl(
  storagePath: string,
  expiresInSeconds = 60 * 60 * 72
): Promise<SignedUrlResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(ORDER_ATTACHMENTS_BUCKET).createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data) return { ok: false, error: error?.message ?? "sin respuesta de Storage" };
  return { ok: true, url: data.signedUrl };
}
