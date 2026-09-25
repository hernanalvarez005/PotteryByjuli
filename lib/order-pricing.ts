// Precio sugerido en /pedidos/nuevo (pedido manual desde el backoffice).
//
// La UNIDAD DE NEGOCIO del pedido decide qué lista de precios sugiere el
// precio de cada ítem (Minorista → lista `retail`, Mayorista → lista
// `wholesale`). Es sólo una SUGERENCIA para el formulario: `create_order`
// sigue guardando el `unit_price` que llega (editable, congelado en
// `order_items` — docs/business-rules.md § Snapshots históricos). No hay un
// segundo sistema de precios: las listas son las mismas `price_lists` /
// `price_list_items` de siempre, y los códigos son los semánticos
// (`retail`/`wholesale`), nunca ids hardcodeados.
//
// Todo acá es puro (sin React ni Supabase) para poder probarlo aislado.

export type PriceListCode = "retail" | "wholesale";

/** Precio de una variante en cada lista; `null` = la lista no lo tiene cargado. */
export type VariantPrices = { retail: number | null; wholesale: number | null };

export const PRICE_LIST_LABELS: Record<PriceListCode, string> = {
  retail: "minorista",
  wholesale: "mayorista",
};

/**
 * Mayorista → lista mayorista; cualquier otra unidad (o ninguna elegida
 * todavía) → lista minorista, que es el comportamiento que el formulario
 * ya tenía para el resto de las unidades (personalizados, ferias, etc.).
 */
export function priceListCodeForBusinessUnit(unitCode: string | null | undefined): PriceListCode {
  return unitCode === "wholesale" ? "wholesale" : "retail";
}

/** `list`: el precio viene de la lista y puede recalcularse; `manual`: lo tipeó la usuaria. */
export type PriceSource = "list" | "manual";

export type CatalogRowPricing = {
  product_variant_id: string;
  variant_label: string | null;
  /** Precios de la variante elegida en las dos listas (null si todavía no eligió variante). */
  prices: VariantPrices | null;
  /** `null` = sin precio: hay que cargarlo a mano antes de guardar. */
  unit_price: number | null;
  priceSource: PriceSource;
};

export type PickedVariant = { id: string; label: string; prices: VariantPrices };

export function listPrice(prices: VariantPrices | null, list: PriceListCode): number | null {
  return prices ? prices[list] : null;
}

/** Elegir (o re-elegir) una variante: el precio vuelve a ser el de la lista. */
export function withPickedVariant<T extends CatalogRowPricing>(row: T, variant: PickedVariant, list: PriceListCode): T {
  return {
    ...row,
    product_variant_id: variant.id,
    variant_label: variant.label,
    prices: variant.prices,
    unit_price: listPrice(variant.prices, list),
    priceSource: "list",
  };
}

/** La usuaria tipeó el precio: deja de ser "de lista" y nunca se pisa en silencio. */
export function withManualPrice<T extends CatalogRowPricing>(row: T, value: number | null): T {
  return { ...row, unit_price: value, priceSource: "manual" };
}

/** "Usar precio de lista": vuelve a la sugerencia de la lista vigente. */
export function withListPrice<T extends CatalogRowPricing>(row: T, list: PriceListCode): T {
  return { ...row, unit_price: listPrice(row.prices, list), priceSource: "list" };
}

/**
 * Cambio de unidad → cambia la lista vigente. Recalcula SÓLO las filas
 * cuyo precio viene de la lista; las filas con precio manual quedan
 * intactas, y las filas sin variante elegida no tienen nada que recalcular.
 */
export function retargetPriceList<T extends CatalogRowPricing>(rows: T[], list: PriceListCode): T[] {
  return rows.map((row) =>
    row.product_variant_id && row.priceSource === "list" ? { ...row, unit_price: listPrice(row.prices, list) } : row
  );
}

export type PriceNotice =
  | { kind: "no_list_price" }
  | { kind: "manual_differs"; listPrice: number | null }
  | null;

/**
 * Qué aviso corresponde debajo de una fila:
 * - sin precio de lista y sin precio cargado → "Sin precio mayorista, cargalo a mano";
 * - precio manual distinto del de la lista → se avisa y se ofrece volver a la lista.
 */
export function priceNotice(row: CatalogRowPricing, list: PriceListCode): PriceNotice {
  if (!row.product_variant_id) return null;
  const fromList = listPrice(row.prices, list);
  if (row.priceSource === "list") return fromList == null ? { kind: "no_list_price" } : null;
  if (fromList == null) return row.unit_price == null ? { kind: "no_list_price" } : { kind: "manual_differs", listPrice: null };
  return row.unit_price === fromList ? null : { kind: "manual_differs", listPrice: fromList };
}

/** Filas de catálogo con variante elegida pero sin precio: bloquean el guardado (nunca se descartan en silencio). */
export function rowsMissingPrice<T extends CatalogRowPricing>(rows: T[]): T[] {
  return rows.filter((row) => row.product_variant_id && row.unit_price == null);
}
