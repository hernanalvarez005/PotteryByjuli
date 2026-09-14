"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner } from "@/lib/auth";
import { CATALOG_TABLES, type CatalogTableKey } from "@/lib/catalog";
import { wholesaleSettingsSchema } from "@/schemas/wholesale";
import { feeSuggestionSchema } from "@/schemas/fee-suggestions";
import { normalizePhoneForStorage } from "@/lib/phone";

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

  // Mismo normalizador que usa el checkout mayorista para el WhatsApp del
  // comprador — así el número que arma el link `wa.me` del botón de éxito
  // siempre queda en la forma correcta (incluye el "9" móvil argentino).
  let businessWhatsapp = parsed.data.business_whatsapp;
  if (businessWhatsapp) {
    const normalized = normalizePhoneForStorage(businessWhatsapp);
    if (!normalized.isValid) {
      return { error: "El WhatsApp ingresado no parece válido." };
    }
    businessWhatsapp = normalized.canonical;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("wholesale_settings")
    .update({ ...parsed.data, business_whatsapp: businessWhatsapp, updated_by: user.id })
    .eq("id", settingsId);

  if (error) return { error: "No se pudo guardar." };

  revalidatePath("/configuracion");
  revalidatePath("/mayorista");
  return {};
}

// payment_method_fee_suggestions (Bloque 3 — comisiones/neto): sólo el
// costo estimado a mostrar antes de cobrar, nunca lo que decide el fee
// real de un pago (eso siempre lo confirma la usuaria en el momento).
export async function createFeeSuggestion(
  _prevState: CatalogActionState,
  formData: FormData
): Promise<CatalogActionState> {
  const user = await requireUser();
  if (!isOwner(user)) {
    return { error: "Sólo la administradora puede configurar comisiones." };
  }

  const parsed = feeSuggestionSchema.safeParse({
    payment_method_id: formData.get("payment_method_id"),
    account_id: formData.get("account_id"),
    suggested_percentage: Number(formData.get("suggested_percentage")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("payment_method_fee_suggestions").insert(parsed.data);
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Ya existe una sugerencia para esa combinación de método y cuenta."
          : "No se pudo guardar.",
    };
  }

  revalidatePath("/configuracion");
  return {};
}

export async function updateFeeSuggestionPercentage(id: string, suggestedPercentage: number) {
  const user = await requireUser();
  if (!isOwner(user)) {
    throw new Error("Sólo la administradora puede configurar comisiones.");
  }
  if (!Number.isFinite(suggestedPercentage) || suggestedPercentage < 0 || suggestedPercentage > 100) {
    throw new Error("El porcentaje tiene que estar entre 0 y 100.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("payment_method_fee_suggestions")
    .update({ suggested_percentage: suggestedPercentage })
    .eq("id", id);
  if (error) throw new Error("No se pudo actualizar.");

  revalidatePath("/configuracion");
}

export async function deleteFeeSuggestion(id: string) {
  const user = await requireUser();
  if (!isOwner(user)) {
    throw new Error("Sólo la administradora puede configurar comisiones.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("payment_method_fee_suggestions").delete().eq("id", id);
  if (error) throw new Error("No se pudo eliminar.");

  revalidatePath("/configuracion");
}
