"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { registrationSchema, eventSchema } from "@/schemas/events";
import { slugify } from "@/lib/slug";

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
    participant_name: parsed.data.participant_name,
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

export async function setRegistrationPaymentStatus(
  eventId: string,
  registrationId: string,
  paymentStatus: string
) {
  await assertCanManageEvents();

  const supabase = await createClient();
  const { error } = await supabase
    .from("event_registrations")
    .update({ payment_status: paymentStatus, paid_at: paymentStatus === "pending" ? null : new Date().toISOString() })
    .eq("id", registrationId);
  if (error) throw new Error("No se pudo actualizar.");

  revalidatePath(`/eventos/${eventId}`);
}

export async function setRegistrationStatus(eventId: string, registrationId: string, status: string) {
  await assertCanManageEvents();

  const supabase = await createClient();
  const { error } = await supabase
    .from("event_registrations")
    .update({ status })
    .eq("id", registrationId);
  if (error) throw new Error(error.message || "No se pudo actualizar.");

  revalidatePath(`/eventos/${eventId}`);
}

export async function deleteRegistration(eventId: string, registrationId: string) {
  const user = await requireUser();
  if (!isOwner(user)) throw new Error("Sólo la administradora puede eliminar definitivamente.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_registration_safe", { p_id: registrationId });
  if (error) throw new Error(error.message || "No se pudo eliminar.");

  revalidatePath(`/eventos/${eventId}`);
}

export async function setEventStatus(eventId: string, status: string) {
  await assertCanManageEvents();

  const supabase = await createClient();
  const { error } = await supabase.from("events").update({ status }).eq("id", eventId);
  if (error) throw new Error("No se pudo actualizar.");

  revalidatePath(`/eventos/${eventId}`);
  revalidatePath("/eventos");
  revalidatePath("/calendario");
}

export async function archiveEvent(eventId: string) {
  await assertCanManageEvents();

  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", eventId);
  if (error) throw new Error("No se pudo archivar.");

  revalidatePath(`/eventos/${eventId}`);
  revalidatePath("/eventos");
}

export async function deleteEvent(eventId: string) {
  const user = await requireUser();
  if (!isOwner(user)) throw new Error("Sólo la administradora puede eliminar definitivamente.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_event_safe", { p_id: eventId });
  if (error) throw new Error(error.message || "No se pudo eliminar.");

  revalidatePath("/eventos");
}

export async function updateEvent(
  eventId: string,
  _prevState: EventDetailState,
  formData: FormData
): Promise<EventDetailState> {
  await assertCanManageEvents();

  const parsed = eventSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const slug = parsed.data.slug ?? (parsed.data.event_type === "workshop" ? slugify(parsed.data.name) : null);
  const { error } = await supabase.from("events").update({ ...parsed.data, slug }).eq("id", eventId);

  if (error) {
    return {
      error: error.code === "23505" ? "Ese link ya está en uso por otro workshop." : "No se pudo guardar.",
    };
  }

  revalidatePath(`/eventos/${eventId}`);
  revalidatePath("/eventos");
  revalidatePath("/calendario");
  return {};
}

export async function publishEvent(eventId: string) {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations") && !hasRole(user, "workshop_staff")) {
    throw new Error("No tenés permiso.");
  }

  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("slug").eq("id", eventId).maybeSingle();
  if (!event?.slug) {
    throw new Error("Definí un link público antes de publicar.");
  }

  const { error } = await supabase.from("events").update({ status: "published" }).eq("id", eventId);
  if (error) throw new Error("No se pudo publicar.");

  revalidatePath(`/eventos/${eventId}`);
  revalidatePath("/eventos");
}

export async function uploadEventImage(eventId: string, storagePath: string) {
  await assertCanManageEvents();

  const supabase = await createClient();
  const { error } = await supabase.from("events").update({ image_path: storagePath }).eq("id", eventId);
  if (error) throw new Error("No se pudo guardar la imagen.");

  revalidatePath(`/eventos/${eventId}`);
}
