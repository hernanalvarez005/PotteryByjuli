"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { specialDateSchema } from "@/schemas/special-dates";
import { calendarReminderSchema } from "@/schemas/calendar-reminders";

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

export type ReminderActionState = { error?: string };

export async function createReminder(
  _prevState: ReminderActionState,
  formData: FormData
): Promise<ReminderActionState> {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    return { error: "No tenés permiso para cargar recordatorios." };
  }

  const parsed = calendarReminderSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("calendar_reminders").insert({ ...parsed.data, created_by: user.id });
  if (error) return { error: "No se pudo guardar el recordatorio." };

  revalidatePath("/calendario");
  return {};
}

export async function setReminderStatus(reminderId: string, completed: boolean) {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    throw new Error("No tenés permiso para modificar recordatorios.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_reminders")
    .update({ status: completed ? "completed" : "pending" })
    .eq("id", reminderId);
  if (error) throw new Error("No se pudo actualizar el recordatorio.");

  revalidatePath("/calendario");
}
