"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { specialDateSchema } from "@/schemas/special-dates";

export type SpecialDateActionState = { error?: string };

export async function createSpecialDate(
  _prevState: SpecialDateActionState,
  formData: FormData
): Promise<SpecialDateActionState> {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    return { error: "No tenés permiso para cargar fechas especiales." };
  }

  const parsed = specialDateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("special_dates").insert({ ...parsed.data, created_by: user.id });
  if (error) return { error: "No se pudo guardar." };

  revalidatePath("/calendario");
  return {};
}
