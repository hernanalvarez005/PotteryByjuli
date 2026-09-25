import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildLiveDocumentData,
  buildSnapshotDocumentData,
  type DocumentCustomerRow,
  type DocumentOrderItemRow,
  type DocumentSettingsRow,
  type WholesaleDocumentData,
} from "@/lib/wholesale-document-data";

// Lectura del pedido para el PDF mayorista y guardado idempotente del
// archivo + su referencia. Agnóstico del cliente de Supabase: lo usan el
// checkout público (service role, ver lib/supabase/admin-server-only.ts) y
// la regeneración desde el backoffice (sesión del usuario) — un solo camino
// de guardado, nunca dos implementaciones que puedan divergir.
//
// Nunca importa la service role key ni React PDF.

export const ORDER_ATTACHMENTS_BUCKET = "order-attachments";
export const WHOLESALE_PDF_KIND = "wholesale_request_pdf";

/** Etapas del pipeline del PDF — se usan tal cual en los logs. */
export type WholesalePdfStep = "load_order" | "render" | "upload" | "attachment_insert" | "signed_url";

/** Error de una etapa concreta: el llamador sabe EN QUÉ paso falló. */
export class WholesalePdfStepError extends Error {
  readonly step: WholesalePdfStep;
  readonly code?: string;
  constructor(step: WholesalePdfStep, message: string, code?: string) {
    super(message);
    this.name = "WholesalePdfStepError";
    this.step = step;
    this.code = code;
  }
}

/** Ruta determinística: la misma para toda regeneración del mismo pedido. */
export function wholesalePdfStoragePath(orderId: string, humanCode: string): string {
  return `${orderId}/${humanCode}.pdf`;
}

/** Alias histórico: el checkout siempre carga un `WholesaleDocumentData` de origen snapshot. */
export type WholesaleOrderForDocument = WholesaleDocumentData;

/**
 * Resultado explícito de la lectura — nunca un `null` mudo:
 * - `not_found`: no hay ningún pedido con ese código/id;
 * - `snapshot_incomplete`: el pedido existe pero no tiene los datos
 *   congelados del checkout (típico de un pedido cargado a mano);
 * - `query_error`: falló la consulta (red, permisos, esquema…).
 */
export type LoadWholesaleOrderResult =
  | { ok: true; order: WholesaleOrderForDocument }
  | { ok: false; reason: "not_found" | "snapshot_incomplete" | "query_error"; orderId?: string; humanCode?: string; detail?: string };

const ORDER_SELECT =
  "id, human_code, created_at, wholesale_buyer_snapshot, wholesale_terms_snapshot, order_items(quantity, unit_price, custom_name, product_variants(name, products(name)))";

type OrderRowForDocument = {
  id: string;
  human_code: string;
  created_at: string;
  wholesale_buyer_snapshot: WholesaleDocumentData["buyer"] | null;
  wholesale_terms_snapshot: WholesaleDocumentData["terms"] | null;
  order_items: DocumentOrderItemRow[];
};

/**
 * Lee todo lo que el PDF necesita, SIEMPRE de datos congelados:
 * `wholesale_buyer_snapshot`, `wholesale_terms_snapshot` y
 * `order_items.unit_price` (nunca `customers`/`wholesale_settings` en
 * vivo) — sólo los nombres de producto/variante se leen del catálogo.
 */
export async function loadWholesaleOrderForDocument(
  supabase: SupabaseClient,
  by: { humanCode: string } | { orderId: string }
): Promise<LoadWholesaleOrderResult> {
  const query = supabase.from("orders").select(ORDER_SELECT);
  const { data, error } = await ("humanCode" in by ? query.eq("human_code", by.humanCode) : query.eq("id", by.orderId)).maybeSingle();

  if (error) return { ok: false, reason: "query_error", detail: `${error.code ?? "?"}: ${error.message}` };
  if (!data) return { ok: false, reason: "not_found" };

  const row = data as unknown as OrderRowForDocument;

  if (!row.wholesale_buyer_snapshot || !row.wholesale_terms_snapshot) {
    return { ok: false, reason: "snapshot_incomplete", orderId: row.id, humanCode: row.human_code };
  }

  return {
    ok: true,
    order: buildSnapshotDocumentData({
      orderId: row.id,
      humanCode: row.human_code,
      createdAt: row.created_at,
      buyerSnapshot: row.wholesale_buyer_snapshot,
      termsSnapshot: row.wholesale_terms_snapshot,
      items: row.order_items,
    }),
  };
}

/**
 * Resultado de `loadWholesaleDocumentData` (backoffice). Además de los
 * motivos del loader del checkout:
 * - `not_wholesale`: el pedido no es de la unidad Mayorista (p. ej. un
 *   pedido minorista): nunca entra al flujo mayorista;
 * - `missing_customer`: pedido manual sin cliente asociado: no hay datos de
 *   comprador para armar el documento.
 */
export type LoadWholesaleDocumentResult =
  | { ok: true; order: WholesaleDocumentData }
  | {
      ok: false;
      reason: "not_found" | "query_error" | "snapshot_incomplete" | "not_wholesale" | "missing_customer";
      orderId?: string;
      humanCode?: string;
      detail?: string;
    };

const DOCUMENT_ORDER_SELECT =
  "id, human_code, created_at, wholesale_buyer_snapshot, wholesale_terms_snapshot, business_units(code), " +
  "customers(first_name, last_name, company_name, cuit, instagram, website, city, province, address, postal_code, whatsapp, email), " +
  "order_items(quantity, unit_price, custom_name, product_variants(name, products(name)))";

/**
 * Lectura para el backoffice: UN camino, dos orígenes.
 *
 * - Con los DOS snapshots del checkout → documento `request`, exactamente
 *   los datos congelados (mismo resultado que `loadWholesaleOrderForDocument`).
 * - Sin ninguno (pedido cargado a mano) → documento `order` armado con el
 *   pedido + el cliente + `wholesale_settings` vigentes. No se inventa ningún
 *   snapshot ni se escribe nada en el pedido.
 * - Sólo UNO de los dos snapshots → dato inconsistente del checkout: falla
 *   con `snapshot_incomplete`, nunca se completa con datos vivos en silencio.
 *
 * Un pedido que no es de la unidad Mayorista y no viene del checkout falla
 * con `not_wholesale`.
 */
export async function loadWholesaleDocumentData(
  supabase: SupabaseClient,
  by: { orderId: string }
): Promise<LoadWholesaleDocumentResult> {
  const { data, error } = await supabase.from("orders").select(DOCUMENT_ORDER_SELECT).eq("id", by.orderId).maybeSingle();

  if (error) return { ok: false, reason: "query_error", detail: `${error.code ?? "?"}: ${error.message}` };
  if (!data) return { ok: false, reason: "not_found" };

  const row = data as unknown as OrderRowForDocument & {
    business_units: { code: string } | null;
    customers: DocumentCustomerRow | null;
  };
  const ref = { orderId: row.id, humanCode: row.human_code };

  const hasBuyer = Boolean(row.wholesale_buyer_snapshot);
  const hasTerms = Boolean(row.wholesale_terms_snapshot);

  if (hasBuyer && hasTerms) {
    return {
      ok: true,
      order: buildSnapshotDocumentData({
        ...ref,
        createdAt: row.created_at,
        buyerSnapshot: row.wholesale_buyer_snapshot!,
        termsSnapshot: row.wholesale_terms_snapshot!,
        items: row.order_items,
      }),
    };
  }
  if (hasBuyer !== hasTerms) return { ok: false, reason: "snapshot_incomplete", ...ref };

  // Pedido cargado a mano.
  if (row.business_units?.code !== "wholesale") return { ok: false, reason: "not_wholesale", ...ref };
  if (!row.customers) return { ok: false, reason: "missing_customer", ...ref };

  const { data: settings, error: settingsError } = await supabase
    .from("wholesale_settings")
    .select("lead_time_min_days, lead_time_max_days, payment_terms, shipping_terms")
    .limit(1)
    .maybeSingle();
  if (settingsError) {
    return { ok: false, reason: "query_error", ...ref, detail: `${settingsError.code ?? "?"}: ${settingsError.message}` };
  }

  return {
    ok: true,
    order: buildLiveDocumentData({
      ...ref,
      createdAt: row.created_at,
      customer: row.customers,
      settings: settings as DocumentSettingsRow,
      items: row.order_items,
    }),
  };
}

/**
 * Guarda el PDF y su referencia de forma IDEMPOTENTE — repetirlo sobre el
 * mismo pedido nunca duplica nada:
 *
 * 1. `upload` con `upsert: true` a la ruta determinística
 *    `{orderId}/{humanCode}.pdf` — reemplaza un archivo huérfano o un PDF
 *    previo en vez de fallar.
 * 2. La referencia (`order_attachments`, `kind = wholesale_request_pdf`) se
 *    ACTUALIZA si ya existe y sólo se inserta si no hay ninguna. Funciona
 *    con o sin el índice único parcial de la migración 20260925120000; con
 *    el índice, una carrera entre dos ejecuciones cae en 23505 y se
 *    resuelve actualizando la fila que ganó.
 *
 * Estados de recuperación: Storage huérfano (archivo sin fila) → se
 * reemplaza y se inserta la fila; fila huérfana (fila sin archivo) → se
 * recrea el archivo y la fila se reutiliza; ninguno → alta normal.
 *
 * Lanza `WholesalePdfStepError` con la etapa (`upload` /
 * `attachment_insert`).
 */
export async function storeWholesaleOrderPdf(
  supabase: SupabaseClient,
  params: { orderId: string; humanCode: string; pdfBytes: Buffer | Uint8Array; uploadedBy?: string | null }
): Promise<string> {
  const { orderId, humanCode, pdfBytes, uploadedBy = null } = params;
  const storagePath = wholesalePdfStoragePath(orderId, humanCode);

  const { error: uploadError } = await supabase.storage
    .from(ORDER_ATTACHMENTS_BUCKET)
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) {
    throw new WholesalePdfStepError("upload", `No se pudo subir el PDF: ${uploadError.message}`);
  }

  const reuseExisting = async () => {
    const { data, error } = await supabase
      .from("order_attachments")
      .update({ storage_path: storagePath })
      .eq("order_id", orderId)
      .eq("kind", WHOLESALE_PDF_KIND)
      .select("id");
    return { updated: (data ?? []).length > 0, error };
  };

  const existing = await reuseExisting();
  if (existing.error) {
    throw new WholesalePdfStepError("attachment_insert", `No se pudo actualizar el adjunto: ${existing.error.message}`, existing.error.code);
  }
  if (existing.updated) return storagePath;

  const { error: insertError } = await supabase
    .from("order_attachments")
    .insert({ order_id: orderId, storage_path: storagePath, kind: WHOLESALE_PDF_KIND, uploaded_by: uploadedBy });

  if (insertError) {
    if (insertError.code === "23505") {
      // Otra ejecución insertó primero (índice único): reusar esa fila.
      const retry = await reuseExisting();
      if (!retry.error && retry.updated) return storagePath;
    }
    throw new WholesalePdfStepError("attachment_insert", `El PDF se subió pero no se pudo registrar: ${insertError.message}`, insertError.code);
  }

  return storagePath;
}
