"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";

export type GenerateDuesState = {
  error?: string;
  result?: { created: number; existing: number; noFee: number };
};

async function assertCanManageDues() {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    throw new Error("No tenés permiso para gestionar cuotas.");
  }
  return user;
}

/**
 * Bulk-generates the month's dues for every active enrollment. Idempotent
 * by construction — the RPC inserts through the existing
 * unique(enrollment_id, period) constraint with ON CONFLICT DO NOTHING,
 * so pressing this twice for the same period never duplicates a due
 * (docs/business-rules.md § Cuotas mensuales de talleres).
 */
export async function generateMonthlyDues(
  _prevState: GenerateDuesState,
  formData: FormData
): Promise<GenerateDuesState> {
  await assertCanManageDues();

  const period = String(formData.get("period") ?? "");
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return { error: "Período inválido — formato esperado AAAA-MM." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_monthly_dues", { p_period: period }).single();
  if (error) return { error: error.message || "No se pudieron generar las cuotas." };

  revalidatePath("/talleres/cuotas");
  revalidatePath("/talleres");

  const row = data as { created_count: number; skipped_existing: number; skipped_no_fee: number };
  return {
    result: { created: row.created_count, existing: row.skipped_existing, noFee: row.skipped_no_fee },
  };
}
