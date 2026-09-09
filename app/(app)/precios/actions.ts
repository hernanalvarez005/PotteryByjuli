"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner } from "@/lib/auth";
import { priceSchema } from "@/schemas/products";

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
  return {};
}
