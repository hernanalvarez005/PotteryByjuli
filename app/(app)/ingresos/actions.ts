"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { incomeEntrySchema } from "@/schemas/finance";
import { dateOnlyToArgentinaNoonISO } from "@/lib/format";

export type IncomeEntryActionState = { error?: string };

export async function createIncomeEntry(
  _prevState: IncomeEntryActionState,
  formData: FormData
): Promise<IncomeEntryActionState> {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    return { error: "No tenés permiso para cargar ingresos." };
  }

  const parsed = incomeEntrySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("income_entries").insert({
    ...parsed.data,
    occurred_at: dateOnlyToArgentinaNoonISO(parsed.data.occurred_at),
    created_by: user.id,
  });
  if (error) return { error: "No se pudo guardar el ingreso." };

  revalidatePath("/ingresos");
  revalidatePath("/dashboard");
  revalidatePath("/reportes");
  return {};
}
