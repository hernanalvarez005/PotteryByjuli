"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, hasRole, isOwner } from "@/lib/auth";
import { productSchema, variantSchema, priceSchema, bulkWholesalePriceSchema } from "@/schemas/products";
import { wholesaleRulesSchema } from "@/schemas/wholesale";
import { lookup as dnsLookup } from "node:dns/promises";
import {
  validateImageUrlShape,
  isPrivateOrReservedIp,
  isAllowedImageContentType,
  extensionForContentType,
  MAX_IMAGE_BYTES,
} from "@/lib/image-url-import";

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

/**
 * Precio mayorista para todas las variantes — sección 4 de la tanda de
 * mejoras operativas. A propósito NO recibe price_list_id ni una lista de
 * variantes del cliente: sólo productId (ya validado por la ruta) y el
 * precio. Vuelve a resolver la lista mayorista por código y las variantes
 * reales de ese producto enteramente del lado del servidor, así un id
 * ajeno o manipulado no puede llegar a afectar otro producto ni la lista
 * minorista. Un único upsert con un array de filas es atómico a nivel de
 * Postgres — no hace falta una RPC nueva para esto.
 */
export async function applyWholesalePriceToAllVariants(
  productId: string,
  _prevState: ProductDetailState,
  formData: FormData
): Promise<ProductDetailState> {
  const user = await requireUser();
  if (!isOwner(user)) {
    return { error: "Sólo la administradora puede modificar precios." };
  }

  const parsed = bulkWholesalePriceSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Precio inválido." };
  }

  const supabase = await createClient();

  const { data: wholesaleList, error: listError } = await supabase
    .from("price_lists")
    .select("id")
    .eq("code", "wholesale")
    .maybeSingle();
  if (listError || !wholesaleList) {
    return { error: "No se encontró la lista de precios mayorista." };
  }

  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .select("id")
    .eq("product_id", productId);
  if (variantsError) return { error: "No se pudieron leer las variantes del producto." };
  if (!variants || variants.length === 0) {
    return { error: "Este producto no tiene variantes." };
  }

  const rows = variants.map((v) => ({
    price_list_id: wholesaleList.id,
    product_variant_id: v.id,
    unit_price: parsed.data.unit_price,
    updated_by: user.id,
  }));

  const { error } = await supabase
    .from("price_list_items")
    .upsert(rows, { onConflict: "price_list_id,product_variant_id" });
  if (error) return { error: "No se pudieron guardar los precios." };

  revalidatePath(`/productos/${productId}`);
  revalidatePath("/productos");
  revalidatePath("/precios");
  revalidatePath("/mayorista");
  return {};
}

/**
 * variantId liga la foto a un modelo puntual (sección 5 — imágenes ↔
 * variantes); null = imagen general, la que se muestra para cualquier
 * variante. Se re-valida server-side que el variantId (si viene) sea
 * realmente una variante de este producto — nunca se confía en el id tal
 * cual llega del cliente.
 */
export async function addProductImage(
  productId: string,
  storagePath: string,
  isFirst: boolean,
  variantId: string | null
) {
  await assertCanManageCatalog();

  const supabase = await createClient();
  const validVariantId = await resolveOwnVariantId(supabase, productId, variantId);

  const { error } = await supabase.from("product_images").insert({
    product_id: productId,
    storage_path: storagePath,
    variant_id: validVariantId,
    is_primary: isFirst,
  });
  if (error) throw new Error("No se pudo guardar la imagen.");

  revalidatePath(`/productos/${productId}`);
  revalidatePath("/mayorista");
}

export async function setImageVariant(
  productId: string,
  imageId: string,
  variantId: string | null
) {
  await assertCanManageCatalog();

  const supabase = await createClient();
  const validVariantId = await resolveOwnVariantId(supabase, productId, variantId);

  const { error } = await supabase
    .from("product_images")
    .update({ variant_id: validVariantId })
    .eq("id", imageId)
    .eq("product_id", productId);
  if (error) throw new Error("No se pudo actualizar.");

  revalidatePath(`/productos/${productId}`);
  revalidatePath("/mayorista");
}

async function resolveOwnVariantId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  productId: string,
  variantId: string | null
): Promise<string | null> {
  if (!variantId) return null;
  const { data } = await supabase
    .from("product_variants")
    .select("id")
    .eq("id", variantId)
    .eq("product_id", productId)
    .maybeSingle();
  return data?.id ?? null;
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

export async function upsertWholesaleRules(
  productId: string,
  _prevState: ProductDetailState,
  formData: FormData
): Promise<ProductDetailState> {
  const user = await requireUser();
  if (!isOwner(user)) {
    return { error: "Sólo la administradora puede modificar reglas mayoristas." };
  }

  const parsed = wholesaleRulesSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("wholesale_product_rules")
    .upsert({ product_id: productId, ...parsed.data }, { onConflict: "product_id" });
  if (error) return { error: "No se pudo guardar." };

  revalidatePath(`/productos/${productId}`);
  revalidatePath("/mayorista");
  return {};
}

export type ImportImageState = { error?: string };

/**
 * "Pegar una URL" (sección 46-52) never stores the external URL as the
 * image itself — it downloads it server-side, validates it's really an
 * image within a size limit, and re-uploads it to this app's own
 * Storage. That's what makes it safe to later point at a Tienda Nube CDN
 * URL: no live dependency on that CDN, no broken image the day it
 * changes (sección 52).
 *
 * SSRF: sección 49's protections happen in two passes — reject the literal
 * hostname/scheme before touching the network (lib/image-url-import.ts),
 * then resolve DNS and reject again if it points at a private/loopback/
 * link-local address (catches a public-looking hostname that resolves to
 * 127.0.0.1 or a cloud metadata IP, which a string check alone would miss).
 */
export async function importProductImageFromUrl(
  productId: string,
  isFirst: boolean,
  _prevState: ImportImageState,
  formData: FormData
): Promise<ImportImageState> {
  await assertCanManageCatalog();

  const supabaseForVariant = await createClient();
  const rawVariantId = String(formData.get("variant_id") ?? "").trim();
  const validVariantId = await resolveOwnVariantId(
    supabaseForVariant,
    productId,
    rawVariantId || null
  );

  const rawUrl = String(formData.get("image_url") ?? "").trim();
  const shapeCheck = validateImageUrlShape(rawUrl);
  if (!shapeCheck.ok) return { error: shapeCheck.error };
  const url = shapeCheck.url;

  try {
    const { address } = await dnsLookup(url.hostname);
    if (isPrivateOrReservedIp(address)) {
      return { error: "Ese host no está permitido." };
    }
  } catch {
    return { error: "No se pudo resolver ese host." };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { error: "No se pudo descargar la imagen." };
  }
  if (!response.ok) return { error: `La URL respondió ${response.status}.` };

  const contentType = response.headers.get("content-type");
  if (!isAllowedImageContentType(contentType)) {
    return { error: "La URL no apunta a una imagen jpg/png/webp." };
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_IMAGE_BYTES) {
    return { error: "La imagen supera el límite de 10 MB." };
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return { error: "La imagen supera el límite de 10 MB." };
  }

  const ext = extensionForContentType(contentType!);
  const path = `${productId}/${crypto.randomUUID()}.${ext}`;

  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(path, buffer, { contentType: contentType!.split(";")[0].trim() });
  if (uploadError) return { error: "No se pudo guardar la imagen." };

  const { error: insertError } = await supabase
    .from("product_images")
    .insert({ product_id: productId, storage_path: path, variant_id: validVariantId, is_primary: isFirst });
  if (insertError) return { error: "No se pudo registrar la imagen." };

  revalidatePath(`/productos/${productId}`);
  revalidatePath("/mayorista");
  return {};
}
