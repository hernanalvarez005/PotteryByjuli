"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { programSchema, groupSchema } from "@/schemas/workshops";

export type WorkshopActionState = { error?: string };

async function assertCanManageWorkshops() {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations") && !hasRole(user, "workshop_staff")) {
    throw new Error("No tenés permiso para gestionar talleres.");
  }
  return user;
}

export async function createProgram(
  _prevState: WorkshopActionState,
  formData: FormData
): Promise<WorkshopActionState> {
  await assertCanManageWorkshops();

  const parsed = programSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("workshop_programs").insert(parsed.data);
  if (error) return { error: "No se pudo crear el programa." };

  revalidatePath("/talleres");
  return {};
}

export async function createGroup(
  _prevState: WorkshopActionState,
  formData: FormData
): Promise<WorkshopActionState> {
  await assertCanManageWorkshops();

  const parsed = groupSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("workshop_groups").insert(parsed.data);
  if (error) return { error: "No se pudo crear el grupo." };

  revalidatePath("/talleres");
  return {};
}
