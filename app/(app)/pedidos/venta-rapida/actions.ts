"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, hasRole, isOwner } from "@/lib/auth";
import { quickSaleSchema } from "@/schemas/quick-sale";
import { getPricesForVariants } from "@/lib/products";
import { dateOnlyToArgentinaNoonISO } from "@/lib/format";

export type QuickSaleActionState = {
  error?: string;
  result?: { orderId: string; humanCode: string; total: number };
};

async function assertCanSell() {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    throw new Error("No tenés permiso para registrar ventas.");
  }
  return user;
}

export async function createQuickSale(
  _prevState: QuickSaleActionState,
  formData: FormData
): Promise<QuickSaleActionState> {
  await assertCanSell();

  let itemsRaw: unknown;
  try {
    itemsRaw = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "Los productos de la venta son inválidos." };
  }

  const parsed = quickSaleSchema.safeParse({
    location_id: formData.get("location_id"),
    payment_method_id: formData.get("payment_method_id"),
    payment_account_id: formData.get("payment_account_id"),
    paid_at: formData.get("paid_at"),
    customer_id: formData.get("customer_id"),
    channel_id: formData.get("channel_id"),
    discount_total: formData.get("discount_total"),
    client_request_id: formData.get("client_request_id"),
    items: itemsRaw,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const input = parsed.data;

  // Chequeo de "¿cambió el precio desde que se abrió la pantalla?" — es UX,
  // no la defensa de fondo (esa la hace el RPC solo, resolviendo el precio
  // él mismo y nunca aceptando uno del cliente). Se hace ANTES de llamar al
  // RPC: evita el caso humano común de dejar la pantalla abierta un rato
  // mientras un precio se actualiza, cortando con un mensaje específico en
  // vez de un pedido creado con un total que ya no coincide con lo que la
  // usuaria vio en pantalla.
  const prices = await getPricesForVariants(input.items.map((it) => it.product_variant_id));
  for (const item of input.items) {
    const currentPrice = prices[item.product_variant_id]?.retail;
    if (currentPrice === undefined || currentPrice !== item.expected_unit_price) {
      return {
        error: "El precio de uno de los productos cambió. Revisá la venta antes de continuar.",
      };
    }
  }

  const supabase = await createClient();
  const { data: rows, error } = await supabase.rpc("create_quick_retail_sale", {
    p_location_id: input.location_id,
    p_items: input.items.map((it) => ({
      product_variant_id: it.product_variant_id,
      quantity: it.quantity,
    })),
    p_payment_method_id: input.payment_method_id,
    p_paid_at: dateOnlyToArgentinaNoonISO(input.paid_at),
    p_customer_id: input.customer_id,
    p_channel_id: input.channel_id,
    p_payment_account_id: input.payment_account_id,
    p_discount_total: input.discount_total ?? 0,
    p_client_request_id: input.client_request_id,
  });

  const row = rows?.[0] as { order_id: string; human_code: string; total: number } | undefined;
  if (error || !row) {
    return { error: error?.message ?? "No se pudo registrar la venta." };
  }

  revalidatePath("/pedidos");
  revalidatePath("/dashboard");
  revalidatePath("/reportes");
  revalidatePath("/stock");

  return { result: { orderId: row.order_id, humanCode: row.human_code, total: row.total } };
}
