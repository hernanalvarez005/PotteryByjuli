"use server";

import { createClient } from "@/lib/supabase/server";
import { publicRegistrationSchema } from "@/schemas/events";

export type WorkshopRegistrationState = {
  error?: string;
  result?: { registration_id: string; event_name: string; event_date: string; price: number | null };
};

export async function submitWorkshopRegistration(
  eventId: string,
  _prevState: WorkshopRegistrationState,
  formData: FormData
): Promise<WorkshopRegistrationState> {
  const parsed = publicRegistrationSchema.safeParse({
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    whatsapp: formData.get("whatsapp"),
    email: formData.get("email"),
    participant_name: formData.get("participant_name"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  // No session here on purpose — runs as `anon`, like a real visitor. The
  // RPC (SECURITY DEFINER) is the only thing allowed to write.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_for_workshop", {
    p_event_id: eventId,
    p_first_name: parsed.data.first_name,
    p_last_name: parsed.data.last_name,
    p_whatsapp: parsed.data.whatsapp,
    p_email: parsed.data.email,
    p_participant_name: parsed.data.participant_name,
    p_notes: parsed.data.notes,
  });

  if (error) {
    return { error: error.message || "No se pudo completar la inscripción." };
  }

  return { result: data as WorkshopRegistrationState["result"] };
}
