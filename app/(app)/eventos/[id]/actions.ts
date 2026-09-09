"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { registrationSchema } from "@/schemas/events";

export type EventDetailState = { error?: string };

async function assertCanManageEvents() {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations") && !hasRole(user, "workshop_staff")) {
    throw new Error("No tenés permiso para gestionar eventos.");
  }
  return user;
}

export async function registerCustomer(
  eventId: string,
  unitPrice: number | null,
  _prevState: EventDetailState,
  formData: FormData
): Promise<EventDetailState> {
  await assertCanManageEvents();

  const parsed = registrationSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("event_registrations").insert({
    event_id: eventId,
    customer_id: parsed.data.customer_id,
    quantity: parsed.data.quantity,
    unit_price: unitPrice,
  });

  if (error) {
    return {
      error: error.message?.includes("cupo") ? error.message : "No se pudo inscribir.",
    };
  }

  revalidatePath(`/eventos/${eventId}`);
  return {};
}

export async function toggleRegistrationPaid(eventId: string, registrationId: string, isPaid: boolean) {
  await assertCanManageEvents();

  const supabase = await createClient();
  const { error } = await supabase
    .from("event_registrations")
    .update({ is_paid: isPaid, paid_at: isPaid ? new Date().toISOString() : null })
    .eq("id", registrationId);
  if (error) throw new Error("No se pudo actualizar.");

  revalidatePath(`/eventos/${eventId}`);
}

export async function cancelRegistration(eventId: string, registrationId: string) {
  await assertCanManageEvents();

  const supabase = await createClient();
  const { error } = await supabase
    .from("event_registrations")
    .update({ status: "cancelled" })
    .eq("id", registrationId);
  if (error) throw new Error("No se pudo cancelar.");

  revalidatePath(`/eventos/${eventId}`);
}

export async function setEventStatus(eventId: string, status: string) {
  await assertCanManageEvents();

  const supabase = await createClient();
  const { error } = await supabase.from("events").update({ status }).eq("id", eventId);
  if (error) throw new Error("No se pudo actualizar.");

  revalidatePath(`/eventos/${eventId}`);
  revalidatePath("/eventos");
}
