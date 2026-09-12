"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, hasRole, isOwner } from "@/lib/auth";
import { createOrderSchema, paymentSchema, ORDER_STATUSES } from "@/schemas/orders";
import { dateOnlyToArgentinaNoonISO } from "@/lib/format";

export type OrderActionState = { error?: string };

async function assertCanManageOrders() {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    throw new Error("No tenés permiso para gestionar pedidos.");
  }
  return user;
}

export async function createOrder(
  _prevState: OrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  const user = await assertCanManageOrders();

  let itemsRaw: unknown;
  try {
    itemsRaw = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "Los ítems del pedido son inválidos." };
  }

  const parsed = createOrderSchema.safeParse({
    business_unit_id: formData.get("business_unit_id"),
    customer_id: formData.get("customer_id"),
    location_id: formData.get("location_id"),
    origin_channel_id: formData.get("origin_channel_id"),
    closing_channel_id: formData.get("closing_channel_id"),
    delivery_method: formData.get("delivery_method"),
    delivery_address: formData.get("delivery_address"),
    estimated_date: formData.get("estimated_date"),
    notes: formData.get("notes"),
    items: itemsRaw,
    register_payment: formData.get("register_payment"),
    payment_amount: formData.get("payment_amount"),
    payment_method_id: formData.get("payment_method_id"),
    payment_account_id: formData.get("payment_account_id"),
    payment_paid_at: formData.get("payment_paid_at"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  if (parsed.data.register_payment) {
    if (!parsed.data.payment_amount || parsed.data.payment_amount <= 0) {
      return { error: "Ingresá el importe del pago." };
    }
    if (!parsed.data.payment_paid_at) {
      return { error: "Ingresá la fecha real del pago." };
    }
  }

  const supabase = await createClient();
  const { data: orderId, error } = await supabase.rpc("create_order", {
    p_business_unit_id: parsed.data.business_unit_id,
    p_customer_id: parsed.data.customer_id,
    p_location_id: parsed.data.location_id,
    p_origin_channel_id: parsed.data.origin_channel_id,
    p_closing_channel_id: parsed.data.closing_channel_id,
    p_delivery_method: parsed.data.delivery_method,
    p_delivery_address: parsed.data.delivery_address,
    p_estimated_date: parsed.data.estimated_date,
    p_notes: parsed.data.notes,
    p_items: parsed.data.items,
  });

  if (error || !orderId) {
    return { error: error?.message ?? "No se pudo crear el pedido." };
  }

  // Pago opcional al crear el pedido — usa `payments` (nunca un campo
  // financiero nuevo en `orders`), mismo contrato paid_at/created_at que
  // el resto de la app. Si esto falla, el pedido ya existe igual: se
  // puede registrar el pago manualmente desde su ficha, así que no vale
  // la pena bloquear la creación por esto.
  if (parsed.data.register_payment && parsed.data.payment_amount && parsed.data.payment_paid_at) {
    await supabase.from("payments").insert({
      order_id: orderId,
      amount: parsed.data.payment_amount,
      method_id: parsed.data.payment_method_id,
      account_id: parsed.data.payment_account_id,
      paid_at: dateOnlyToArgentinaNoonISO(parsed.data.payment_paid_at),
      created_by: user.id,
    });
  }

  revalidatePath("/pedidos");
  redirect(`/pedidos/${orderId}`);
}

export async function changeOrderStatus(orderId: string, status: string) {
  await assertCanManageOrders();
  if (!ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) {
    throw new Error("Estado inválido.");
  }

  const supabase = await createClient();
  // set_order_status (not a plain update) — it also reserves/consumes/
  // releases stock as the status moves through confirmed/delivered/
  // cancelled. See supabase/migrations/*_phase4_stock.sql.
  const { error } = await supabase.rpc("set_order_status", {
    p_order_id: orderId,
    p_new_status: status,
  });
  if (error) throw new Error(error.message || "No se pudo cambiar el estado.");

  revalidatePath(`/pedidos/${orderId}`);
  revalidatePath("/pedidos");
  revalidatePath("/stock");
}

export async function associateOrderCustomer(orderId: string, customerId: string) {
  await assertCanManageOrders();

  const supabase = await createClient();
  const { error } = await supabase
    .from("orders")
    .update({ customer_id: customerId })
    .eq("id", orderId);
  if (error) throw new Error("No se pudo asociar el cliente.");

  revalidatePath(`/pedidos/${orderId}`);
  revalidatePath("/pedidos");
}

export async function addPayment(
  orderId: string,
  _prevState: OrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  const user = await assertCanManageOrders();

  const parsed = paymentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("payments").insert({
    ...parsed.data,
    paid_at: dateOnlyToArgentinaNoonISO(parsed.data.paid_at),
    order_id: orderId,
    created_by: user.id,
  });
  if (error) return { error: "No se pudo registrar el pago." };

  revalidatePath(`/pedidos/${orderId}`);
  revalidatePath("/pedidos");
  return {};
}
