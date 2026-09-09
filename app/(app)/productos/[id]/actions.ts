"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, hasRole, isOwner } from "@/lib/auth";
import { productSchema, variantSchema, priceSchema } from "@/schemas/products";

export type ProductDetailState = { error?: string };

async function assertCanManageCatalog() {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    throw new Error("No tenés permiso para editar el catálogo.");
  }
  return user;
}

export async function updateProduct(
  productId: string,
  _prevState: ProductDetailState,
  formData: FormData
): Promise<ProductDetailState> {
  await assertCanManageCatalog();

  const parsed = productSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update(parsed.data)
    .eq("id", productId);
  if (error) return { error: "No se pudo guardar." };

  revalidatePath(`/productos/${productId}`);
  revalidatePath("/productos");
  return {};
}

export async function createVariant(
  productId: string,
  _prevState: ProductDetailState,
  formData: FormData
): Promise<ProductDetailState> {
  await assertCanManageCatalog();

  const parsed = variantSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .insert({ ...parsed.data, product_id: productId });

  if (error) {
    return {
      error: error.code === "23505" ? "Ya existe una variante con ese nombre." : "No se pudo crear.",
    };
  }

  revalidatePath(`/productos/${productId}`);
  return {};
}

export async function toggleVariantActive(
  productId: string,
  variantId: string,
  isActive: boolean
) {
  await assertCanManageCatalog();

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .update({ is_active: isActive })
    .eq("id", variantId);
  if (error) throw new Error("No se pudo actualizar.");

  revalidatePath(`/productos/${productId}`);
}

export async function upsertPrice(
  productId: string,
  _prevState: ProductDetailState,
  formData: FormData
): Promise<ProductDetailState> {
  const user = await requireUser();
  if (!isOwner(user)) {
    return { error: "Sólo la administradora puede modificar precios." };
  }

  const parsed = priceSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Precio inválido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("price_list_items").upsert(
    { ...parsed.data, updated_by: user.id },
    { onConflict: "price_list_id,product_variant_id" }
  );
  if (error) return { error: "No se pudo guardar el precio." };

  revalidatePath(`/productos/${productId}`);
  revalidatePath("/productos");
  revalidatePath("/precios");
  return {};
}

export async function addProductImage(
  productId: string,
  storagePath: string,
  isFirst: boolean
) {
  await assertCanManageCatalog();

  const supabase = await createClient();
  const { error } = await supabase.from("product_images").insert({
    product_id: productId,
    storage_path: storagePath,
    is_primary: isFirst,
  });
  if (error) throw new Error("No se pudo guardar la imagen.");

  revalidatePath(`/productos/${productId}`);
}

export async function deleteProductImage(
  productId: string,
  imageId: string,
  storagePath: string
) {
  await assertCanManageCatalog();

  const supabase = await createClient();
  await supabase.storage.from("product-images").remove([storagePath]);
  const { error } = await supabase.from("product_images").delete().eq("id", imageId);
  if (error) throw new Error("No se pudo borrar la imagen.");

  revalidatePath(`/productos/${productId}`);
}

export async function setPrimaryImage(productId: string, imageId: string) {
  await assertCanManageCatalog();

  const supabase = await createClient();
  await supabase
    .from("product_images")
    .update({ is_primary: false })
    .eq("product_id", productId);
  const { error } = await supabase
    .from("product_images")
    .update({ is_primary: true })
    .eq("id", imageId);
  if (error) throw new Error("No se pudo actualizar.");

  revalidatePath(`/productos/${productId}`);
}
