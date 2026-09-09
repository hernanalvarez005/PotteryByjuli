"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, hasRole, isOwner } from "@/lib/auth";
import {
  newProductionOrderSchema,
  completeProductionSchema,
  PRODUCTION_STAGE_ORDER,
} from "@/schemas/production";

export type ProductionActionState = { error?: string };

async function assertCanManageProduction() {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    throw new Error("No tenés permiso para gestionar producción.");
  }
  return user;
}

export async function createProductionOrder(
  _prevState: ProductionActionState,
  formData: FormData
): Promise<ProductionActionState> {
  const user = await assertCanManageProduction();

  const parsed = newProductionOrderSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("production_orders")
    .insert({ ...parsed.data, origin: "restock", created_by: user.id });
  if (error) return { error: "No se pudo crear la orden." };

  revalidatePath("/produccion");
  return {};
}

export async function advanceStage(id: string, currentStatus: string) {
  await assertCanManageProduction();

  const currentIndex = PRODUCTION_STAGE_ORDER.indexOf(
    currentStatus as (typeof PRODUCTION_STAGE_ORDER)[number]
  );
  const next = PRODUCTION_STAGE_ORDER[currentIndex + 1];
  if (!next) throw new Error("Ya está en la última etapa antes de completar.");

  const supabase = await createClient();
  const { error } = await supabase.from("production_orders").update({ status: next }).eq("id", id);
  if (error) throw new Error("No se pudo avanzar la etapa.");

  revalidatePath("/produccion");
}

export async function cancelProductionOrder(id: string) {
  await assertCanManageProduction();

  const supabase = await createClient();
  const { error } = await supabase
    .from("production_orders")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) throw new Error("No se pudo cancelar.");

  revalidatePath("/produccion");
}

export async function completeProductionOrder(
  id: string,
  _prevState: ProductionActionState,
  formData: FormData
): Promise<ProductionActionState> {
  await assertCanManageProduction();

  const parsed = completeProductionSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_production_order", {
    p_id: id,
    p_produced_quantity: parsed.data.produced_quantity,
    p_rejected_quantity: parsed.data.rejected_quantity,
  });
  if (error) return { error: error.message || "No se pudo completar la orden." };

  revalidatePath("/produccion");
  revalidatePath("/stock");
  return {};
}
