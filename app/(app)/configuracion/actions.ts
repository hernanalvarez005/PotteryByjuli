"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner } from "@/lib/auth";
import { CATALOG_TABLES, type CatalogTableKey } from "@/lib/catalog";
import { wholesaleSettingsSchema } from "@/schemas/wholesale";

export type CatalogActionState = { error?: string };

/**
 * `table` only ever comes from a hidden input rendered by our own form, and
 * is narrowed against the fixed CATALOG_TABLES registry before it ever
 * touches `supabase.from(...)` — never interpolated from arbitrary input.
 */
export async function createCatalogItem(
  table: CatalogTableKey,
  _prevState: CatalogActionState,
  formData: FormData
): Promise<CatalogActionState> {
  const user = await requireUser();
  if (!isOwner(user)) {
    return { error: "Sólo la administradora puede modificar la configuración." };
  }

  const config = CATALOG_TABLES[table];
  if (!config) return { error: "Tabla de configuración inválida." };

  const raw = Object.fromEntries(formData.entries());
  const parsed = config.schema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from(table).insert(parsed.data);

  if (error) {
    return {
      error: error.code === "23505" ? "Ese código ya existe." : "No se pudo guardar.",
    };
  }

  revalidatePath("/configuracion");
  return {};
}

export async function toggleCatalogItemActive(
  table: CatalogTableKey,
  id: string,
  isActive: boolean
) {
  const user = await requireUser();
  if (!isOwner(user)) {
    throw new Error("Sólo la administradora puede modificar la configuración.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from(table)
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) throw new Error("No se pudo actualizar.");
  revalidatePath("/configuracion");
}

export async function updateWholesaleSettings(
  settingsId: string,
  _prevState: CatalogActionState,
  formData: FormData
): Promise<CatalogActionState> {
  const user = await requireUser();
  if (!isOwner(user)) {
    return { error: "Sólo la administradora puede modificar la configuración mayorista." };
  }

  const parsed = wholesaleSettingsSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("wholesale_settings")
    .update({ ...parsed.data, updated_by: user.id })
    .eq("id", settingsId);

  if (error) return { error: "No se pudo guardar." };

  revalidatePath("/configuracion");
  revalidatePath("/mayorista");
  return {};
}
