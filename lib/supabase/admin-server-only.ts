import { createClient } from "@supabase/supabase-js";

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

const ORDER_ATTACHMENTS_BUCKET = "order-attachments";

export type WholesaleOrderForDocument = {
  orderId: string;
  createdAt: string;
  buyer: {
    first_name: string;
    last_name: string | null;
    company_name: string | null;
    cuit: string | null;
    instagram: string | null;
    website: string | null;
    city: string | null;
    province: string | null;
    address: string | null;
    postal_code: string | null;
    whatsapp: string;
    email: string | null;
  };
  terms: {
    min_order_amount: number | null;
    min_total_units: number | null;
    lead_time_min_days: number | null;
    lead_time_max_days: number | null;
    payment_terms: string | null;
    shipping_terms: string | null;
  };
  items: { productName: string; variantName: string; quantity: number; unitPrice: number }[];
};

/**
 * Reads everything the PDF (and the storage path, which is keyed by
 * `orderId`) needs for a given order, by its human-readable code. The
 * wholesale checkout Server Action runs as `anon`, which has no select
 * policy on `orders` — this is the one place that read happens, via the
 * service role, immediately after `submit_wholesale_request` succeeds
 * (that RPC only returns `human_code`, on purpose — see the migration
 * comment for why its signature isn't touched again just for this).
 *
 * Reads `wholesale_buyer_snapshot` / `wholesale_terms_snapshot` — never
 * live `customers`/`wholesale_settings` — and `order_items.unit_price`
 * (already historical) joined only for product/variant *names* (the one
 * piece of display data this table doesn't itself snapshot; see
 * docs/business-rules.md for why that's an accepted, narrow exception).
 */
export async function getWholesaleOrderForDocument(humanCode: string): Promise<WholesaleOrderForDocument | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, created_at, wholesale_buyer_snapshot, wholesale_terms_snapshot, order_items(quantity, unit_price, product_variants(name, products(name)))"
    )
    .eq("human_code", humanCode)
    .single();

  if (error || !data || !data.wholesale_buyer_snapshot || !data.wholesale_terms_snapshot) return null;

  const buyer = data.wholesale_buyer_snapshot as WholesaleOrderForDocument["buyer"];
  const terms = data.wholesale_terms_snapshot as WholesaleOrderForDocument["terms"];
  const items = (data.order_items as unknown as {
    quantity: number;
    unit_price: number;
    product_variants: { name: string; products: { name: string } } | null;
  }[]).map((item) => ({
    productName: item.product_variants?.products.name ?? "",
    variantName: item.product_variants?.name ?? "",
    quantity: item.quantity,
    unitPrice: item.unit_price,
  }));

  return { orderId: data.id as string, createdAt: data.created_at as string, buyer, terms, items };
}

/**
 * Uploads the wholesale request PDF to the private `order-attachments`
 * bucket at `{orderId}/{humanCode}.pdf` — the order's UUID directory is
 * the real access boundary; the human code is only there for a readable
 * filename, never relied on for security (a private bucket that somehow
 * became misconfigured would otherwise be sequentially guessable by
 * human_code alone).
 *
 * Also records the `order_attachments` row (`kind: 'wholesale_request_pdf'`)
 * — its mere presence is what the backoffice checks to know "this order
 * has a document" (no separate status column; see docs/database.md).
 */
export async function uploadWholesaleOrderPdf(orderId: string, humanCode: string, pdfBytes: Buffer): Promise<string> {
  const supabase = createAdminClient();
  const storagePath = `${orderId}/${humanCode}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(ORDER_ATTACHMENTS_BUCKET)
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    throw new Error(`No se pudo subir el PDF del pedido ${humanCode}: ${uploadError.message}`);
  }

  const { error: insertError } = await supabase.from("order_attachments").insert({
    order_id: orderId,
    storage_path: storagePath,
    kind: "wholesale_request_pdf",
  });

  if (insertError) {
    throw new Error(
      `El PDF del pedido ${humanCode} se subió pero no se pudo registrar el adjunto: ${insertError.message}`
    );
  }

  return storagePath;
}

/**
 * Mints a time-limited signed URL for a stored wholesale request PDF.
 * 72hs is the default for the link that travels in the buyer's WhatsApp
 * message (documented tradeoff — see docs/business-rules.md §
 * Checkout mayorista). Staff mint their own short-lived signed URL on
 * demand from the backoffice using their normal authenticated session
 * (no service role needed there — `order_attachments_staff_read` already
 * grants any authenticated user select on this bucket), so a longer
 * duration here isn't needed to cover Juli's side of the flow.
 */
export async function createWholesalePdfSignedUrl(
  storagePath: string,
  expiresInSeconds = 60 * 60 * 72
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(ORDER_ATTACHMENTS_BUCKET).createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data) return null;
  return data.signedUrl;
}
