"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { enrollmentSchema, dueSchema } from "@/schemas/workshops";

export type WorkshopDetailState = { error?: string };

async function assertCanManageWorkshops() {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations") && !hasRole(user, "workshop_staff")) {
    throw new Error("No tenés permiso para gestionar talleres.");
  }
  return user;
}

async function assertCanManageDues() {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    throw new Error("No tenés permiso para gestionar cuotas.");
  }
  return user;
}

export async function enrollCustomer(
  groupId: string,
  _prevState: WorkshopDetailState,
  formData: FormData
): Promise<WorkshopDetailState> {
  await assertCanManageWorkshops();

  const parsed = enrollmentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("workshop_enrollments")
    .insert({ ...parsed.data, group_id: groupId });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Esa persona ya está inscripta en este grupo."
          : error.message?.includes("cupo")
            ? error.message
            : "No se pudo inscribir.",
    };
  }

  revalidatePath(`/talleres/${groupId}`);
  return {};
}

export async function setEnrollmentStatus(groupId: string, enrollmentId: string, status: string) {
  await assertCanManageWorkshops();

  const supabase = await createClient();
  const { error } = await supabase
    .from("workshop_enrollments")
    .update({ status })
    .eq("id", enrollmentId);
  if (error) throw new Error(error.message || "No se pudo actualizar.");

  revalidatePath(`/talleres/${groupId}`);
}

export async function markAttendance(
  groupId: string,
  enrollmentId: string,
  sessionDate: string,
  status: string
) {
  await assertCanManageWorkshops();

  const supabase = await createClient();
  const { error } = await supabase
    .from("attendance_records")
    .upsert(
      { enrollment_id: enrollmentId, session_date: sessionDate, status },
      { onConflict: "enrollment_id,session_date" }
    );
  if (error) throw new Error("No se pudo registrar la asistencia.");

  revalidatePath(`/talleres/${groupId}`);
}

export async function createDue(
  groupId: string,
  enrollmentId: string,
  _prevState: WorkshopDetailState,
  formData: FormData
): Promise<WorkshopDetailState> {
  await assertCanManageDues();

  const parsed = dueSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("workshop_dues")
    .insert({ ...parsed.data, enrollment_id: enrollmentId });

  if (error) {
    return {
      error: error.code === "23505" ? "Ya existe una cuota para ese período." : "No se pudo crear.",
    };
  }

  revalidatePath(`/talleres/${groupId}`);
  return {};
}

export async function toggleDuePaid(groupId: string, dueId: string, isPaid: boolean) {
  await assertCanManageDues();

  const supabase = await createClient();
  const { error } = await supabase
    .from("workshop_dues")
    .update({ is_paid: isPaid, paid_at: isPaid ? new Date().toISOString() : null })
    .eq("id", dueId);
  if (error) throw new Error("No se pudo actualizar.");

  revalidatePath(`/talleres/${groupId}`);
}
