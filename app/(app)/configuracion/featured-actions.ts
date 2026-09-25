"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner } from "@/lib/auth";
import { getProductsPage } from "@/lib/products";
import { slugify } from "@/lib/slug";
import { dateOnlyToArgentinaStartOfDayISO, dateOnlyToArgentinaEndOfDayISO } from "@/lib/format";
import { featuredSectionSchema } from "@/schemas/wholesale-featured";

// Secciones destacadas del catálogo mayorista — SOLO owner (decisión
// explícita: no se amplía a operations). El RLS de escritura también
// exige owner; el chequeo de acá da el mensaje claro.

const OWNER_ONLY = "Sólo la administradora puede modificar las secciones destacadas.";

export type FeaturedSectionActionState = { error?: string; saved?: boolean };

function revalidate() {
  revalidatePath("/configuracion");
  revalidatePath("/mayorista");
}

export async function saveFeaturedSection(
  _prevState: FeaturedSectionActionState,
  formData: FormData
): Promise<FeaturedSectionActionState> {
  const user = await requireUser();
  if (!isOwner(user)) return { error: OWNER_ONLY };

  let productIds: unknown;
  try {
    productIds = JSON.parse(String(formData.get("product_ids") ?? "[]"));
  } catch {
    return { error: "La lista de productos es inválida." };
  }

  const parsed = featuredSectionSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description"),
    is_active: formData.get("is_active"),
    starts_on: formData.get("starts_on"),
    ends_on: formData.get("ends_on"),
    product_ids: productIds,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  const input = parsed.data;

  const supabase = await createClient();
  const baseSlug = slugify(input.title) || "seccion";

  // El slug es un ancla estable, sólo se fija al crear. Si ya existe otro
  // igual (dos secciones con el mismo nombre) se reintenta una vez con un
  // sufijo corto.
  for (const slug of [baseSlug, `${baseSlug}-${Date.now().toString(36).slice(-4)}`]) {
    const { error } = await supabase.rpc("save_wholesale_featured_section", {
      p_id: input.id,
      p_title: input.title,
      p_slug: slug,
      p_description: input.description,
      p_is_active: input.is_active,
      p_starts_at: input.starts_on ? dateOnlyToArgentinaStartOfDayISO(input.starts_on) : null,
      p_ends_at: input.ends_on ? dateOnlyToArgentinaEndOfDayISO(input.ends_on) : null,
      p_product_ids: input.product_ids,
    });

    if (!error) {
      revalidate();
      return { saved: true };
    }
    if (error.code === "23505" && !input.id) continue; // slug duplicado: reintentar con sufijo
    if (error.code === "23503") return { error: "Alguno de los productos ya no existe." };
    return { error: error.message || "No se pudo guardar la sección." };
  }
  return { error: "No se pudo generar un identificador único para la sección." };
}

export async function setFeaturedSectionActive(id: string, isActive: boolean) {
  const user = await requireUser();
  if (!isOwner(user)) throw new Error(OWNER_ONLY);
  z.string().uuid().parse(id);

  const supabase = await createClient();
  const { error } = await supabase.from("wholesale_featured_sections").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error("No se pudo actualizar.");
  revalidate();
}

/** Borra la sección y (por cascade) sólo sus asociaciones — nunca los productos. */
export async function deleteFeaturedSection(id: string) {
  const user = await requireUser();
  if (!isOwner(user)) throw new Error(OWNER_ONLY);
  z.string().uuid().parse(id);

  const supabase = await createClient();
  const { error } = await supabase.from("wholesale_featured_sections").delete().eq("id", id);
  if (error) throw new Error("No se pudo eliminar.");
  revalidate();
}

/** El orden del array pasa a ser el orden de las secciones (una sola sentencia). */
export async function reorderFeaturedSections(orderedIds: string[]) {
  const user = await requireUser();
  if (!isOwner(user)) throw new Error(OWNER_ONLY);
  const ids = z.array(z.string().uuid()).max(200).parse(orderedIds);

  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_wholesale_featured_sections", { p_section_ids: ids });
  if (error) throw new Error("No se pudo reordenar.");
  revalidate();
}

export type PickableProduct = { id: string; name: string; hasWholesalePrice: boolean };

/**
 * Búsqueda server-side para el selector de productos del editor — el mismo
 * motor de catálogo que /productos (getProductsPage), nunca el catálogo
 * entero. Sólo productos activos y habilitados para mayorista; los que
 * todavía no tienen precio mayorista se marcan para avisar que no se
 * mostrarían.
 */
export async function searchWholesaleProducts(
  query: string
): Promise<{ results: PickableProduct[] } | { error: true }> {
  const user = await requireUser();
  if (!isOwner(user)) return { error: true };

  const q = query.trim();
  if (q.length < 2) return { results: [] };

  try {
    const { products, prices } = await getProductsPage("active", q, null, 20, { wholesaleOnly: true });
    return {
      results: products.map((p) => ({
        id: p.id,
        name: p.name,
        hasWholesalePrice: p.product_variants.some((v) => v.is_active && (prices[v.id]?.wholesale ?? 0) > 0),
      })),
    };
  } catch {
    return { error: true };
  }
}
