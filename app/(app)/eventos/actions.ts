"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { eventSchema } from "@/schemas/events";

export type EventActionState = { error?: string };

async function assertCanManageEvents() {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations") && !hasRole(user, "workshop_staff")) {
    throw new Error("No tenés permiso para gestionar eventos.");
  }
  return user;
}

export async function createEvent(
  _prevState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const user = await assertCanManageEvents();

  const parsed = eventSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("events").insert({ ...parsed.data, created_by: user.id });
  if (error) return { error: "No se pudo crear el evento." };

  revalidatePath("/eventos");
  return {};
}
