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
