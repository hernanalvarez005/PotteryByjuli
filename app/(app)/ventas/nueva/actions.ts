"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, hasRole, isOwner } from "@/lib/auth";
import { quickSaleSchema } from "@/schemas/quick-sale";
import { dateOnlyToArgentinaNoonISO } from "@/lib/format";

export type QuickSaleActionState = {
  error?: string;
  result?: { orderId: string; humanCode: string; total: number };
};

type QuoteRow = { price_condition_id: string; price_condition_name: string; total: number };

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
    client_request_id: formData.get("client_request_id"),
    price_condition_id: formData.get("price_condition_id"),
    expected_total: Number(formData.get("expected_total")),
    items: itemsRaw,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const input = parsed.data;
  const quotedItems = input.items.map((it) => ({
    product_variant_id: it.product_variant_id,
    quantity: it.quantity,
  }));

  const supabase = await createClient();

  // Chequeo de "¿cambió la cotización desde que se mostró la card?" — es
  // UX, no la defensa de fondo (esa la hace create_quick_retail_sale
  // solo, resolviendo el precio él mismo y nunca aceptando un total del
  // cliente). Se re-cotiza con el mismo RPC de sólo lectura que pintó las
  // cards, justo antes de confirmar — si la condición elegida ya no
  // aparece (se desactivó, o algún precio se borró) o su total cambió,
  // se corta acá con un mensaje específico en vez de un pedido creado
  // con un total que ya no coincide con lo que la usuaria vio en pantalla.
  const { data: freshQuotes, error: quoteError } = await supabase.rpc("quote_retail_sale", {
    p_items: quotedItems,
  });
  if (quoteError) {
    return { error: "No se pudo verificar la cotización. Probá de nuevo." };
  }
  const freshQuote = (freshQuotes as QuoteRow[] | null)?.find(
    (q) => q.price_condition_id === input.price_condition_id
  );
  if (!freshQuote) {
    return {
      error: "La condición de precio elegida ya no está disponible. Revisá la venta antes de continuar.",
    };
  }
  if (freshQuote.total !== input.expected_total) {
    return { error: "El precio cambió. Revisá la venta antes de continuar." };
  }

  const { data: rows, error } = await supabase.rpc("create_quick_retail_sale", {
    p_location_id: input.location_id,
    p_items: quotedItems,
    p_payment_method_id: input.payment_method_id,
    p_paid_at: dateOnlyToArgentinaNoonISO(input.paid_at),
    p_customer_id: input.customer_id,
    p_channel_id: input.channel_id,
    p_payment_account_id: input.payment_account_id,
    p_discount_total: 0,
    p_client_request_id: input.client_request_id,
    p_price_condition_id: input.price_condition_id,
  });

  const row = rows?.[0] as { order_id: string; human_code: string; total: number } | undefined;
  if (error || !row) {
    return { error: error?.message ?? "No se pudo registrar la venta." };
  }

  revalidatePath("/ventas");
  revalidatePath("/dashboard");
  revalidatePath("/reportes");
  revalidatePath("/stock");

  return { result: { orderId: row.order_id, humanCode: row.human_code, total: row.total } };
}
