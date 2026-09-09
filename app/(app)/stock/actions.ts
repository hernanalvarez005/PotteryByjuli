"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, hasRole, isOwner } from "@/lib/auth";
import { adjustmentSchema, createTransferSchema } from "@/schemas/inventory";

export type StockActionState = { error?: string };

async function assertCanManageStock() {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    throw new Error("No tenés permiso para gestionar stock.");
  }
  return user;
}

export async function createAdjustment(
  _prevState: StockActionState,
  formData: FormData
): Promise<StockActionState> {
  const user = await assertCanManageStock();

  const parsed = adjustmentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("inventory_movements").insert({
    inventory_item_id: parsed.data.inventory_item_id,
    location_id: parsed.data.location_id,
    movement_type: "adjustment",
    quantity: parsed.data.quantity,
    reason: parsed.data.reason,
    created_by: user.id,
  });
  if (error) return { error: "No se pudo registrar el ajuste." };

  revalidatePath("/stock");
  return {};
}

export type TransferActionState = { error?: string };

export async function createTransfer(
  _prevState: TransferActionState,
  formData: FormData
): Promise<TransferActionState> {
  const user = await assertCanManageStock();

  let itemsRaw: unknown;
  try {
    itemsRaw = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "Los productos son inválidos." };
  }

  const parsed = createTransferSchema.safeParse({
    from_location_id: formData.get("from_location_id"),
    to_location_id: formData.get("to_location_id"),
    notes: formData.get("notes"),
    items: itemsRaw,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { data: transfer, error } = await supabase
    .from("stock_transfers")
    .insert({
      from_location_id: parsed.data.from_location_id,
      to_location_id: parsed.data.to_location_id,
      notes: parsed.data.notes,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !transfer) return { error: "No se pudo crear la transferencia." };

  const { error: itemsError } = await supabase.from("stock_transfer_items").insert(
    parsed.data.items.map((it) => ({
      transfer_id: transfer.id,
      inventory_item_id: it.inventory_item_id,
      quantity: it.quantity,
    }))
  );
  if (itemsError) return { error: "No se pudieron guardar los productos de la transferencia." };

  revalidatePath("/stock");
  return {};
}

export async function completeTransfer(transferId: string) {
  await assertCanManageStock();

  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_stock_transfer", {
    p_transfer_id: transferId,
  });
  if (error) throw new Error(error.message || "No se pudo completar la transferencia.");

  revalidatePath("/stock");
}
