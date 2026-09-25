import type { SupabaseClient } from "@supabase/supabase-js";
import type { WholesaleProduct } from "@/lib/wholesale";

// Secciones destacadas del catálogo mayorista (ver la migración
// 20260925090000). Una sección es sólo una referencia editorial a
// productos: la visibilidad de cada producto la decide el catálogo
// (products.is_active + wholesale_product_rules.is_public + variante
// activa + precio mayorista), nunca la sección.

export type FeaturedSectionRow = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  wholesale_featured_section_products: { product_id: string; sort_order: number }[];
};

export type FeaturedSection = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  products: WholesaleProduct[];
};

export type FeaturedSectionStatus = "live" | "scheduled" | "expired" | "inactive";

/**
 * Estado de una sección en `now`. `is_active=false` gana siempre (es el
 * override manual: archivo/desactivación) y las fechas son opcionales —
 * sin fechas y activa, está vigente. `ends_at` es inclusivo.
 */
export function getFeaturedSectionStatus(
  section: Pick<FeaturedSectionRow, "is_active" | "starts_at" | "ends_at">,
  now: Date
): FeaturedSectionStatus {
  if (!section.is_active) return "inactive";
  const t = now.getTime();
  if (section.starts_at && new Date(section.starts_at).getTime() > t) return "scheduled";
  if (section.ends_at && new Date(section.ends_at).getTime() < t) return "expired";
  return "live";
}

/**
 * Convierte las filas crudas en lo que se pinta en /mayorista.
 *
 * - Sólo secciones vigentes, en el orden de `sort_order`.
 * - Los productos salen de `catalogProducts` (el catálogo YA filtrado por
 *   visibilidad): un producto asociado que hoy es inactivo, no público,
 *   sin variante válida o sin precio mayorista simplemente no está ahí y
 *   no se muestra — la asociación no se toca (Juli decide en el editor).
 * - Una sección sin ningún producto visible no se muestra.
 * - Este filtro de aplicación es necesario aunque `anon` tenga RLS: una
 *   usuaria autenticada lee todas las filas (mismo motivo que el bug de
 *   is_public en getWholesaleCatalog).
 */
export function resolveFeaturedSections(
  rows: FeaturedSectionRow[],
  catalogProducts: WholesaleProduct[],
  now: Date
): FeaturedSection[] {
  const byId = new Map(catalogProducts.map((p) => [p.id, p]));

  return rows
    .filter((row) => getFeaturedSectionStatus(row, now) === "live")
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description,
      products: [...row.wholesale_featured_section_products]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((link) => byId.get(link.product_id))
        .filter((p): p is WholesaleProduct => p !== undefined),
    }))
    .filter((section) => section.products.length > 0);
}

const PUBLIC_SELECT =
  "id,title,slug,description,is_active,starts_at,ends_at,sort_order,wholesale_featured_section_products(product_id,sort_order)";

/**
 * Una sola query embebida (sin N+1 por sección ni por producto). Nunca
 * rompe el catálogo: si falla (p. ej. la migración todavía no se aplicó en
 * ese entorno) devuelve [] y /mayorista queda exactamente como sin
 * secciones.
 */
export async function fetchFeaturedSectionRows(supabase: SupabaseClient): Promise<FeaturedSectionRow[]> {
  const { data, error } = await supabase
    .from("wholesale_featured_sections")
    .select(PUBLIC_SELECT)
    .eq("is_active", true)
    .order("sort_order");
  if (error || !data) return [];
  return data as unknown as FeaturedSectionRow[];
}

export type FeaturedSectionAdmin = Omit<FeaturedSectionRow, "wholesale_featured_section_products"> & {
  products: { productId: string; name: string }[];
};

/** Backoffice: TODAS las secciones (activas, programadas, vencidas e
 * inactivas), con el nombre de cada producto asociado en su orden. */
export async function fetchFeaturedSectionsAdmin(supabase: SupabaseClient): Promise<FeaturedSectionAdmin[]> {
  const { data, error } = await supabase
    .from("wholesale_featured_sections")
    .select(
      "id,title,slug,description,is_active,starts_at,ends_at,sort_order,wholesale_featured_section_products(product_id,sort_order,products(name))"
    )
    .order("sort_order")
    .order("title");
  if (error || !data) return [];

  return (
    data as unknown as (Omit<FeaturedSectionRow, "wholesale_featured_section_products"> & {
      wholesale_featured_section_products: { product_id: string; sort_order: number; products: { name: string } | null }[];
    })[]
  ).map(({ wholesale_featured_section_products: links, ...section }) => ({
    ...section,
    products: [...links]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => ({ productId: l.product_id, name: l.products?.name ?? "(producto)" })),
  }));
}
