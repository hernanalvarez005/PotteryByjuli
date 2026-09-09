"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, hasRole, isOwner } from "@/lib/auth";
import { productSchema } from "@/schemas/products";

export type ProductActionState = { error?: string };

function canManageCatalog(user: Awaited<ReturnType<typeof requireUser>>) {
  return isOwner(user) || hasRole(user, "operations");
}

export async function createProduct(
  _prevState: ProductActionState,
  formData: FormData
): Promise<ProductActionState> {
  const user = await requireUser();
  if (!canManageCatalog(user)) {
    return { error: "No tenés permiso para crear productos." };
  }

  const parsed = productSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert(parsed.data);
  if (error) return { error: "No se pudo crear el producto." };

  revalidatePath("/productos");
  return {};
}

export async function toggleProductActive(id: string, isActive: boolean) {
  const user = await requireUser();
  if (!canManageCatalog(user)) throw new Error("No tenés permiso.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw new Error("No se pudo actualizar.");

  revalidatePath("/productos");
}

export type BulkPriceState = { error?: string; applied?: number };

/**
 * Applies one adjustment to every variant's existing price row in the
 * chosen list(s) — never creates a price where none existed (an
 * "increase" of nothing isn't meaningful), never touches historical
 * order_items (those already snapshot their own unit_price at sale time,
 * docs/business-rules.md § Snapshots históricos — untouched by design,
 * not by anything this action does).
 */
export async function applyBulkPriceAdjustment(
  _prevState: BulkPriceState,
  formData: FormData
): Promise<BulkPriceState> {
  const user = await requireUser();
  if (!canManageCatalog(user)) return { error: "No tenés permiso para ajustar precios." };

  const variantIds = formData.getAll("variant_id").map(String);
  const listScope = String(formData.get("list_scope") ?? ""); // 'retail' | 'wholesale' | 'both'
  const kind = String(formData.get("kind") ?? ""); // 'percentage' | 'fixed'
  const operation = String(formData.get("operation") ?? ""); // 'increase' | 'decrease'
  const value = Number(formData.get("value"));

  if (variantIds.length === 0) return { error: "No hay productos seleccionados." };
  if (!["retail", "wholesale", "both"].includes(listScope)) return { error: "Lista inválida." };
  if (kind !== "percentage" && kind !== "fixed") return { error: "Tipo inválido." };
  if (operation !== "increase" && operation !== "decrease") return { error: "Operación inválida." };
  if (!Number.isFinite(value) || value <= 0) return { error: "Importe/porcentaje inválido." };

  const { applyPriceAdjustment } = await import("@/lib/pricing");
  const supabase = await createClient();

  const { data: priceLists } = await supabase.from("price_lists").select("id,code");
  const listCodes = listScope === "both" ? ["retail", "wholesale"] : [listScope];
  const targetListIds = (priceLists ?? [])
    .filter((l) => listCodes.includes(l.code))
    .map((l) => l.id);

  const { data: existingPrices } = await supabase
    .from("price_list_items")
    .select("id,price_list_id,product_variant_id,unit_price")
    .in("product_variant_id", variantIds)
    .in("price_list_id", targetListIds);

  let applied = 0;
  for (const row of existingPrices ?? []) {
    const newPrice = applyPriceAdjustment(row.unit_price, {
      kind: kind as "percentage" | "fixed",
      operation: operation as "increase" | "decrease",
      value,
    });
    const { error } = await supabase
      .from("price_list_items")
      .update({ unit_price: newPrice, updated_by: user.id })
      .eq("id", row.id);
    if (!error) applied += 1;
  }

  // One audit row per bulk operation (docs/business-rules.md § Auditoría
  // obligatoria) — per-row updated_by/updated_at already says who touched
  // a given price last; this says what the batch that did it actually was.
  for (const listId of targetListIds) {
    const countForList = (existingPrices ?? []).filter((r) => r.price_list_id === listId).length;
    if (countForList === 0) continue;
    await supabase.from("price_bulk_adjustments").insert({
      price_list_id: listId,
      adjustment_kind: kind,
      operation,
      value,
      affected_count: countForList,
      created_by: user.id,
    });
  }

  revalidatePath("/productos");
  revalidatePath("/precios");
  return { applied };
}
