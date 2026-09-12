"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner } from "@/lib/auth";
import { priceSchema } from "@/schemas/products";
import { createPriceConditionSchema } from "@/schemas/price-conditions";
import { slugify } from "@/lib/slug";

export type PriceActionState = { error?: string };

export async function upsertPrice(
  _prevState: PriceActionState,
  formData: FormData
): Promise<PriceActionState> {
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
  if (error) return { error: "No se pudo guardar." };

  revalidatePath("/precios");
  revalidatePath("/productos");
  // Un precio mayorista editado acá es exactamente lo que /mayorista
  // muestra al público — sin esto, un cambio de precio podía quedar
  // sirviendo una respuesta cacheada hasta la próxima revalidación
  // natural de esa ruta (auditoría de la tanda de usabilidad, ítem 26).
  revalidatePath("/mayorista");
  return {};
}

export type CreatePriceConditionActionState = { error?: string };

export async function createPriceCondition(
  _prevState: CreatePriceConditionActionState,
  formData: FormData
): Promise<CreatePriceConditionActionState> {
  const user = await requireUser();
  if (!isOwner(user)) {
    return { error: "Sólo la administradora puede crear condiciones de precio." };
  }

  let paymentMethodIds: unknown;
  try {
    paymentMethodIds = JSON.parse(String(formData.get("payment_method_ids") ?? "[]"));
  } catch {
    return { error: "Los métodos de pago elegidos son inválidos." };
  }

  const parsed = createPriceConditionSchema.safeParse({
    name: formData.get("name"),
    payment_method_ids: paymentMethodIds,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  // El código se deriva del nombre acá — la usuaria nunca lo escribe a
  // mano. Si el slug resultante ya existe (dos nombres que sólo difieren
  // en tildes/mayúsculas, o un reintento), se le agrega un sufijo corto
  // para no chocar con create_price_condition (que rechaza duplicados).
  const baseCode = slugify(parsed.data.name) || "condicion";
  const code = `${baseCode}-${Date.now().toString(36).slice(-4)}`;

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_price_condition", {
    p_code: code,
    p_name: parsed.data.name,
    p_payment_method_ids: parsed.data.payment_method_ids,
  });
  if (error) {
    return { error: error.message || "No se pudo crear la condición de precio." };
  }

  revalidatePath("/precios");
  revalidatePath("/ventas/nueva");
  return {};
}

export async function setPriceConditionActive(id: string, isActive: boolean) {
  const user = await requireUser();
  if (!isOwner(user)) {
    throw new Error("Sólo la administradora puede modificar condiciones de precio.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("price_conditions").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error("No se pudo actualizar.");

  revalidatePath("/precios");
  revalidatePath("/ventas/nueva");
}
