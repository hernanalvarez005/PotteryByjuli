"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { enrollmentSchema, dueSchema, duePaymentSchema, groupMonthlyFeeSchema } from "@/schemas/workshops";

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

/**
 * Registers a real payment against a due — never a boolean flip.
 * "Pagada"/"Parcial" fall out of summing these against workshop_dues.amount
 * (lib/workshop-dues.ts), same as every other payable in this app never
 * storing "cobrado" directly (docs/business-rules.md § Facturación ≠
 * cobranza). Reuses `payments`, not a second ledger.
 */
export async function registerDuePayment(
  groupId: string,
  dueId: string,
  _prevState: WorkshopDetailState,
  formData: FormData
): Promise<WorkshopDetailState> {
  const user = await assertCanManageDues();

  const parsed = duePaymentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("payments").insert({
    workshop_due_id: dueId,
    amount: parsed.data.amount,
    method_id: parsed.data.method_id,
    account_id: parsed.data.account_id,
    reference: parsed.data.reference,
    created_by: user.id,
  });
  if (error) return { error: "No se pudo registrar el pago." };

  revalidatePath(`/talleres/${groupId}`);
  revalidatePath("/talleres/cuotas");
  return {};
}

export async function cancelDue(groupId: string, dueId: string) {
  await assertCanManageDues();

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_due", { p_id: dueId });
  if (error) throw new Error(error.message || "No se pudo cancelar la cuota.");

  revalidatePath(`/talleres/${groupId}`);
  revalidatePath("/talleres/cuotas");
}

export async function updateGroupMonthlyFee(
  groupId: string,
  _prevState: WorkshopDetailState,
  formData: FormData
): Promise<WorkshopDetailState> {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    return { error: "No tenés permiso para editar la cuota mensual." };
  }

  const parsed = groupMonthlyFeeSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("workshop_groups")
    .update({ monthly_fee: parsed.data.monthly_fee })
    .eq("id", groupId);
  if (error) return { error: "No se pudo actualizar." };

  revalidatePath(`/talleres/${groupId}`);
  return {};
}

export async function deleteEnrollment(groupId: string, enrollmentId: string) {
  const user = await requireUser();
  if (!isOwner(user)) throw new Error("Sólo la administradora puede eliminar definitivamente.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_enrollment_safe", { p_id: enrollmentId });
  if (error) throw new Error(error.message || "No se pudo eliminar.");

  revalidatePath(`/talleres/${groupId}`);
}

export async function archiveGroup(groupId: string) {
  const user = await requireUser();
  if (!isOwner(user)) throw new Error("Sólo la administradora puede archivar.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("workshop_groups")
    .update({ archived_at: new Date().toISOString(), is_active: false })
    .eq("id", groupId);
  if (error) throw new Error("No se pudo archivar.");

  revalidatePath(`/talleres/${groupId}`);
  revalidatePath("/talleres");
}

export async function deleteGroup(groupId: string) {
  const user = await requireUser();
  if (!isOwner(user)) throw new Error("Sólo la administradora puede eliminar definitivamente.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_workshop_group_safe", { p_id: groupId });
  if (error) throw new Error(error.message || "No se pudo eliminar.");

  revalidatePath("/talleres");
  redirect("/talleres");
}
