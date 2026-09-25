// Datos de un documento mayorista (PDF), independientes de DE DÓNDE salen.
//
// `renderWholesaleOrderPdf` recibe SIEMPRE un `WholesaleDocumentData` y no
// sabe si el pedido vino del checkout público o lo cargó Juli a mano:
//
//   - `checkout_snapshot` → `kind: "request"`. Comprador y condiciones son
//     los snapshots congelados por `submit_wholesale_request`
//     (`wholesale_buyer_snapshot` / `wholesale_terms_snapshot`); los ítems,
//     `order_items.unit_price` (histórico). Regenerar da SIEMPRE lo mismo,
//     aunque hoy cambie el cliente o la configuración.
//   - `order_live` → `kind: "order"`. Un pedido cargado a mano NO tiene
//     snapshots, y no se inventan: el comprador sale de `customers` y las
//     condiciones de `wholesale_settings` AL MOMENTO DE GENERAR. El PDF
//     guardado es lo que queda "congelado"; regenerar es un acto explícito y
//     toma los datos vigentes (p. ej. una dirección corregida). Los precios
//     igual son históricos: siempre `order_items.unit_price`.
//
// Todo acá es puro (sin Supabase ni React) para poder probarlo aislado.

export type WholesaleDocumentBuyer = {
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
  /** Un cliente cargado a mano puede no tener WhatsApp. */
  whatsapp: string | null;
  email: string | null;
};

export type WholesaleDocumentTerms = {
  min_order_amount: number | null;
  min_total_units: number | null;
  lead_time_min_days: number | null;
  lead_time_max_days: number | null;
  payment_terms: string | null;
  shipping_terms: string | null;
};

export type WholesaleDocumentItem = {
  productName: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
};

/** `request`: solicitud del checkout (pendiente de confirmación). `order`: pedido cargado por Pottery. */
export type WholesaleDocumentKind = "request" | "order";
export type WholesaleDocumentSource = "checkout_snapshot" | "order_live";

export type WholesaleDocumentData = {
  kind: WholesaleDocumentKind;
  source: WholesaleDocumentSource;
  orderId: string;
  humanCode: string;
  createdAt: string;
  buyer: WholesaleDocumentBuyer;
  terms: WholesaleDocumentTerms;
  items: WholesaleDocumentItem[];
};

/** Fila de `order_items` con lo necesario para el documento. */
export type DocumentOrderItemRow = {
  quantity: number;
  unit_price: number;
  custom_name?: string | null;
  product_variants: { name: string; products: { name: string } | null } | null;
};

/**
 * Ítems del documento. Un ítem personalizado (sin variante, con
 * `custom_name`) usa ese nombre; una variante huérfana queda con nombre
 * vacío (nunca rompe la generación).
 */
export function documentItemsFromRows(rows: DocumentOrderItemRow[]): WholesaleDocumentItem[] {
  return rows.map((item) => ({
    productName: item.product_variants?.products?.name ?? item.custom_name ?? "",
    variantName: item.product_variants?.name ?? "",
    quantity: item.quantity,
    unitPrice: item.unit_price,
  }));
}

export function buildSnapshotDocumentData(input: {
  orderId: string;
  humanCode: string;
  createdAt: string;
  buyerSnapshot: WholesaleDocumentBuyer;
  termsSnapshot: WholesaleDocumentTerms;
  items: DocumentOrderItemRow[];
}): WholesaleDocumentData {
  return {
    kind: "request",
    source: "checkout_snapshot",
    orderId: input.orderId,
    humanCode: input.humanCode,
    createdAt: input.createdAt,
    buyer: input.buyerSnapshot,
    terms: input.termsSnapshot,
    items: documentItemsFromRows(input.items),
  };
}

/** Columnas de `customers` que usa el documento. */
export type DocumentCustomerRow = {
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
  whatsapp: string | null;
  email: string | null;
};

/** Columnas de `wholesale_settings` que usa el documento. */
export type DocumentSettingsRow = {
  lead_time_min_days: number | null;
  lead_time_max_days: number | null;
  payment_terms: string | null;
  shipping_terms: string | null;
} | null;

const blankToNull = (v: string | null | undefined) => (v && v.trim() ? v : null);

export function buildLiveDocumentData(input: {
  orderId: string;
  humanCode: string;
  createdAt: string;
  customer: DocumentCustomerRow;
  settings: DocumentSettingsRow;
  items: DocumentOrderItemRow[];
}): WholesaleDocumentData {
  const { customer, settings } = input;
  return {
    kind: "order",
    source: "order_live",
    orderId: input.orderId,
    humanCode: input.humanCode,
    createdAt: input.createdAt,
    buyer: {
      first_name: customer.first_name,
      last_name: blankToNull(customer.last_name),
      company_name: blankToNull(customer.company_name),
      cuit: blankToNull(customer.cuit),
      instagram: blankToNull(customer.instagram),
      website: blankToNull(customer.website),
      city: blankToNull(customer.city),
      province: blankToNull(customer.province),
      address: blankToNull(customer.address),
      postal_code: blankToNull(customer.postal_code),
      whatsapp: blankToNull(customer.whatsapp),
      email: blankToNull(customer.email),
    },
    // Los MÍNIMOS (monto / piezas) son una condición para SOLICITAR por el
    // checkout; en un pedido que Pottery ya cargó no aplican (puede haberse
    // aceptado por debajo del mínimo a propósito) y confundirían: no se
    // incluyen. Sí plazo, pago y envío generales.
    terms: {
      min_order_amount: null,
      min_total_units: null,
      lead_time_min_days: settings?.lead_time_min_days ?? null,
      lead_time_max_days: settings?.lead_time_max_days ?? null,
      payment_terms: blankToNull(settings?.payment_terms),
      shipping_terms: blankToNull(settings?.shipping_terms),
    },
    items: documentItemsFromRows(input.items),
  };
}
