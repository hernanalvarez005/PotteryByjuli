"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { expenseSchema } from "@/schemas/finance";

export type ExpenseActionState = { error?: string };

export async function createExpense(
  _prevState: ExpenseActionState,
  formData: FormData
): Promise<ExpenseActionState> {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    return { error: "No tenés permiso para cargar gastos." };
  }

  const parsed = expenseSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("expenses").insert({ ...parsed.data, created_by: user.id });
  if (error) return { error: "No se pudo guardar el gasto." };

  revalidatePath("/gastos");
  revalidatePath("/reportes");
  return {};
}
