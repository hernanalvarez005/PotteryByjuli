"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { eventSchema } from "@/schemas/events";
import { slugify } from "@/lib/slug";

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
  const slug = parsed.data.slug ?? (parsed.data.event_type === "workshop" ? slugify(parsed.data.name) : null);

  const { data, error } = await supabase
    .from("events")
    .insert({ ...parsed.data, slug, created_by: user.id })
    .select("id")
    .single();

  if (error) {
    return {
      error: error.code === "23505" ? "Ese link ya está en uso por otro workshop." : "No se pudo crear el evento.",
    };
  }

  revalidatePath("/eventos");
  redirect(`/eventos/${data.id}`);
}
