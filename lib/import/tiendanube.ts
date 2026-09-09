// Pure mapping logic for the Tienda Nube catalog export → Pottery's
// existing catalog model. No Supabase client here on purpose — this file
// only turns CSV rows into a typed import plan; scripts/import-tiendanube.ts
// is the only place that talks to the database, so this half is trivial to
// unit test. See docs/business-rules.md § Importación de datos reales.

import { parseDelimitedRecords } from "./csv";

export const TIENDANUBE_DELIMITER = ";";
export const TIENDANUBE_SOURCE = "tiendanube";

export type TiendaNubeRow = {
  identifier: string;
  name: string;
  categories: string;
  property1Value: string;
  price: string;
  promoPrice: string;
  stock: string;
  sku: string;
  showInStore: string;
  description: string;
  cost: string;
};

const RAW_TO_ROW: Record<keyof TiendaNubeRow, string> = {
  identifier: "Identificador de URL",
  name: "Nombre",
  categories: "Categorías",
  property1Value: "Valor de propiedad 1",
  price: "Precio",
  promoPrice: "Precio promocional",
  stock: "Stock",
  sku: "SKU",
  showInStore: "Mostrar en tienda",
  description: "Descripción",
  cost: "Costo",
};

export function parseTiendaNubeCsv(text: string): TiendaNubeRow[] {
  const records = parseDelimitedRecords(text, TIENDANUBE_DELIMITER);
  return records.map((record) => {
    const row = {} as TiendaNubeRow;
    (Object.keys(RAW_TO_ROW) as (keyof TiendaNubeRow)[]).forEach((key) => {
      row[key] = (record[RAW_TO_ROW[key]] ?? "").trim();
    });
    return row;
  });
}

/**
 * Tienda Nube's export repeats a product across N rows (one per variant
 * combination) sharing the same "Identificador de URL" — only the FIRST
 * row of the group carries the product-level fields (name, category,
 * description...); later rows have them blank. This groups rows back into
 * one product per identifier, carrying the id forward across blank-id rows
 * exactly like the export intends (never treating a variant row as its own
 * product).
 */
export function groupTiendaNubeRows(rows: TiendaNubeRow[]): TiendaNubeRow[][] {
  const groups = new Map<string, TiendaNubeRow[]>();
  let currentId: string | null = null;

  for (const row of rows) {
    if (row.identifier) {
      currentId = row.identifier;
      if (!groups.has(currentId)) groups.set(currentId, []);
    }
    if (currentId === null) continue; // malformed row before any id — skip, don't crash
    groups.get(currentId)!.push(row);
  }

  return [...groups.values()];
}

/**
 * ARS amounts in this export are formatted "27,500.00" — comma thousands
 * separator, dot decimals — NOT "27.5". Strips the thousands separator,
 * parses the decimal, and rounds to the nearest whole peso (the business
 * never prices in cents — docs/business-rules.md § Argentina, moneda).
 */
export function parseArsAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/,/g, "");
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

export function parseStockQuantity(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

/**
 * The 4 legacy "seña" (deposit) rows aren't physical products — they're
 * Tienda Nube's ad-hoc way of charging a workshop deposit before this
 * platform's own workshop module existed. Matched by name rather than a
 * hardcoded id list so it generalizes if Tienda Nube ever adds a fifth one
 * the same way (docs/business-rules.md § Importación — servicios legacy).
 */
export function isLegacyWorkshopDeposit(name: string): boolean {
  return /seña/i.test(name);
}

export type CategoryMapping = { csvToken: string; categoryCode: string | null; isNew: boolean };

// First category token (before the first comma — a product can carry
// several, only one fits the current single-category model) → an
// existing product_categories.code, or a new one worth adding.
// "madera" is the only new category proposed: 13/67 products (a
// distinct material, not a vajilla/decor sub-type) — everything else maps
// onto the 6 categories already seeded in Fase 2. See the import report
// for the full breakdown; this is a judgment call, not a fact pulled from
// the CSV, and is called out for review before --apply.
const CATEGORY_MAP: Record<string, string | null> = {
  "MADERA": "madera",
  "VAJILLA > TAZAS": "tazas",
  "VAJILLA > MATES": "mates",
  "MACETAS": "macetas",
  "NAVIDAD": "decoracion",
  "DIA DE LA MADRE": "decoracion",
  "DÍA DE LA MADRE": "decoracion",
  "DÍA DE LAS INFANCIAS": "decoracion",
  "DIA DE LAS INFANCIAS": "decoracion",
  "HOGAR": "decoracion",
  "VELAS": "decoracion",
  "WORKSHOP": null, // only ever the legacy deposit rows, excluded before this applies
  "": null,
};

export const NEW_CATEGORY_CODES = ["madera"];

export function mapTiendaNubeCategory(rawCategories: string): CategoryMapping {
  const first = rawCategories.split(",")[0]?.trim() ?? "";
  const key = first.toUpperCase();

  let categoryCode: string | null;
  if (key in CATEGORY_MAP) {
    categoryCode = CATEGORY_MAP[key];
  } else if (key.startsWith("VAJILLA") || key.startsWith("CUBIERTOS")) {
    categoryCode = "vajilla";
  } else {
    // Unknown token this file's audit never saw — surfaced as a warning
    // rather than silently dropped or guessed.
    categoryCode = null;
  }

  const isNew = categoryCode !== null && NEW_CATEGORY_CODES.includes(categoryCode);
  return { csvToken: first, categoryCode, isNew };
}

export type ProductPlan = {
  externalId: string;
  name: string;
  description: string | null;
  categoryToken: string;
  categoryCode: string | null;
  isVisible: boolean;
  costEstimate: number | null;
  retailPrice: number | null;
  promoPrice: number | null;
  variants: { name: string; stock: number }[];
  isSimple: boolean;
};

export type PlanWarning = { externalId: string; message: string };

export type TiendaNubePlan = {
  products: ProductPlan[];
  legacyExcluded: { externalId: string; name: string }[];
  warnings: PlanWarning[];
  categoriesDetected: CategoryMapping[];
  totals: {
    csvRows: number;
    productsDetected: number;
    physicalProducts: number;
    legacyExcluded: number;
    visible: number;
    hidden: number;
    variantsTotal: number;
    stockTotal: number;
    withCost: number;
    withPromo: number;
  };
};

/** Builds the full import plan from parsed+grouped CSV rows. Pure — no I/O. */
export function buildTiendaNubePlan(rows: TiendaNubeRow[]): TiendaNubePlan {
  const groups = groupTiendaNubeRows(rows);
  const warnings: PlanWarning[] = [];
  const legacyExcluded: TiendaNubePlan["legacyExcluded"] = [];
  const products: ProductPlan[] = [];
  const categoriesDetected: CategoryMapping[] = [];
  let variantsTotal = 0;
  let stockTotal = 0;
  let withCost = 0;
  let withPromo = 0;

  for (const group of groups) {
    const head = group[0];

    if (isLegacyWorkshopDeposit(head.name)) {
      legacyExcluded.push({ externalId: head.identifier, name: head.name });
      continue;
    }

    const mapping = mapTiendaNubeCategory(head.categories);
    categoriesDetected.push(mapping);
    if (mapping.categoryCode === null && mapping.csvToken !== "") {
      warnings.push({
        externalId: head.identifier,
        message: `Categoría no mapeada: "${mapping.csvToken}" — se importa sin categoría.`,
      });
    }

    const isVisible = head.showInStore.trim().toUpperCase() === "SI";
    const retailPrice = parseArsAmount(head.price);
    if (retailPrice === null) {
      warnings.push({ externalId: head.identifier, message: "Sin precio minorista válido." });
    }

    // Promo price: repeated identically on every variant row when present.
    const promoRaw = group.find((r) => r.promoPrice.trim())?.promoPrice ?? "";
    const promoPrice = parseArsAmount(promoRaw);
    if (promoPrice !== null) {
      withPromo += 1;
      warnings.push({
        externalId: head.identifier,
        message: `Tiene precio promocional (${promoPrice}) — Pottery todavía no modela promociones; no se aplica a ningún price_list, sólo queda documentado en este reporte.`,
      });
    }

    // Cost: take the first non-blank value in the group; flag if the
    // group disagrees with itself (shouldn't happen, but don't silently
    // pick one over the other without saying so).
    const costValues = [...new Set(group.map((r) => r.cost.trim()).filter(Boolean))];
    if (costValues.length > 1) {
      warnings.push({
        externalId: head.identifier,
        message: `Costo inconsistente entre variantes (${costValues.join(", ")}) — se usa el primero.`,
      });
    }
    const costEstimate = costValues.length > 0 ? parseArsAmount(costValues[0]) : null;
    if (costEstimate !== null) withCost += 1;

    const isSimple = group.length === 1 && !group[0].property1Value;
    const variants = isSimple
      ? [{ name: "Único", stock: parseStockQuantity(head.stock) }]
      : group.map((r) => ({
          name: r.property1Value.trim() || "Único",
          stock: parseStockQuantity(r.stock),
        }));

    // Two variant rows resolving to the same name (a data-entry duplicate
    // in Tienda Nube) would collide on the (product_id, name) constraint —
    // catch it here with a clear message instead of a raw DB error later.
    const seenNames = new Map<string, number>();
    for (const v of variants) {
      seenNames.set(v.name, (seenNames.get(v.name) ?? 0) + 1);
    }
    for (const [name, count] of seenNames) {
      if (count > 1) {
        warnings.push({
          externalId: head.identifier,
          message: `Variante duplicada "${name}" (${count} filas) — se importa una sola vez, sumando el stock.`,
        });
      }
    }
    const mergedVariants = [...seenNames.keys()].map((name) => ({
      name,
      stock: variants.filter((v) => v.name === name).reduce((sum, v) => sum + v.stock, 0),
    }));

    variantsTotal += mergedVariants.length;
    stockTotal += mergedVariants.reduce((sum, v) => sum + v.stock, 0);

    products.push({
      externalId: head.identifier,
      name: head.name,
      description: head.description ? stripHtml(head.description) : null,
      categoryToken: mapping.csvToken,
      categoryCode: mapping.categoryCode,
      isVisible,
      costEstimate,
      retailPrice,
      promoPrice,
      variants: mergedVariants,
      isSimple,
    });
  }

  const visible = products.filter((p) => p.isVisible).length;

  return {
    products,
    legacyExcluded,
    warnings,
    categoriesDetected,
    totals: {
      csvRows: rows.length,
      productsDetected: groups.length,
      physicalProducts: products.length,
      legacyExcluded: legacyExcluded.length,
      visible,
      hidden: products.length - visible,
      variantsTotal,
      stockTotal,
      withCost,
      withPromo,
    },
  };
}

// Tienda Nube descriptions come through as raw HTML (<p>, &aacute; etc.).
// products.description is plain text everywhere else in the app — strip
// tags and decode the handful of entities this export actually uses
// rather than rendering raw markup as a customer-facing description.
const ENTITY_MAP: Record<string, string> = {
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  Ntilde: "Ñ",
  amp: "&",
  quot: '"',
  nbsp: " ",
};

export function stripHtml(html: string): string {
  const withoutTags = html.replace(/<[^>]+>/g, " ");
  const withEntities = withoutTags.replace(/&([a-zA-Z]+);/g, (match, name: string) =>
    name in ENTITY_MAP ? ENTITY_MAP[name] : match
  );
  return withEntities.replace(/\s+/g, " ").trim();
}
