"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { campaignSchema } from "@/schemas/finance";

export type CampaignActionState = { error?: string };

export async function createCampaign(
  _prevState: CampaignActionState,
  formData: FormData
): Promise<CampaignActionState> {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    return { error: "No tenés permiso para crear campañas." };
  }

  const parsed = campaignSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").insert(parsed.data);
  if (error) return { error: "No se pudo crear la campaña." };

  revalidatePath("/campanas");
  return {};
}
