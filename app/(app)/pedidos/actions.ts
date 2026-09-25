"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
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

// Kanban (Bloque 4): archivar nunca borra el pedido, su historial ni sus
// pagos — sólo lo saca del tablero operativo por default (getOrders
// filtra `archived_at is null` salvo que se pida explícitamente lo
// contrario). Siempre reversible.
export async function archiveOrder(orderId: string) {
  await assertCanManageOrders();

  const supabase = await createClient();
  const { error } = await supabase
    .from("orders")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", orderId);
  if (error) throw new Error("No se pudo archivar el pedido.");

  revalidatePath("/pedidos");
  revalidatePath(`/pedidos/${orderId}`);
}

export async function unarchiveOrder(orderId: string) {
  await assertCanManageOrders();

  const supabase = await createClient();
  const { error } = await supabase.from("orders").update({ archived_at: null }).eq("id", orderId);
  if (error) throw new Error("No se pudo desarchivar el pedido.");

  revalidatePath("/pedidos");
  revalidatePath(`/pedidos/${orderId}`);
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

/**
 * Corrige un pago de pedido/venta ya cargado — mismo patrón que
 * updateDuePayment (talleres/[groupId]/actions.ts): `payments` admite
 * UPDATE directo (la RLS ya lo permite para cualquier pago, sin
 * distinguir order_id de workshop_due_id) y el trigger
 * payments_log_correction audita el cambio solo — nunca se anula ni se
 * recrea la fila. Scopeado a `orderId` además de `paymentId` — nunca
 * confía en que el id que llega del cliente pertenezca a este pedido.
 * `/ventas` se revalida siempre (no sólo cuando el pedido es
 * operation_type='retail_sale'): barato, y evita una consulta extra
 * sólo para decidir si hace falta.
 */
export async function updatePayment(
  orderId: string,
  paymentId: string,
  _prevState: OrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  await assertCanManageOrders();

  const parsed = paymentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("payments")
    .update({
      amount: parsed.data.amount,
      paid_at: dateOnlyToArgentinaNoonISO(parsed.data.paid_at),
      method_id: parsed.data.method_id,
      account_id: parsed.data.account_id,
      reference: parsed.data.reference,
      notes: parsed.data.notes,
      fee_amount: parsed.data.fee_amount,
    })
    .eq("id", paymentId)
    .eq("order_id", orderId);
  if (error) return { error: "No se pudo actualizar el pago." };

  revalidatePath(`/pedidos/${orderId}`);
  revalidatePath("/pedidos");
  revalidatePath("/ventas");
  revalidatePath("/dashboard");
  return {};
}

export type DeleteOrderResult = { error?: string };

const ORDER_ATTACHMENTS_BUCKET = "order-attachments";

/**
 * Eliminación DEFINITIVA de un pedido cargado por error — sólo owner y sólo
 * si el pedido no tiene consecuencias operativas ni financieras (0 pagos, 0
 * movimientos de stock, 0 órdenes de producción, no entregado, no del
 * checkout). La regla y el borrado viven en Postgres (`delete_order_safe`,
 * una transacción que re-verifica con el pedido bloqueado); nunca se borra
 * en pasos desde acá. Cualquier otro pedido se cancela, no se borra.
 *
 * Storage no forma parte de esa transacción: los adjuntos (PDF) se borran
 * DESPUÉS del commit. Si eso falla el pedido igual ya no existe (un archivo
 * huérfano es inocuo: bucket privado, ruta con el uuid del pedido), así que
 * no se reporta como error al usuario pero SÍ queda un log estructurado.
 */
export async function deleteOrder(orderId: string, reason?: string): Promise<DeleteOrderResult> {
  const user = await requireUser();
  if (!isOwner(user)) return { error: "Sólo la administradora puede eliminar pedidos." };
  if (!z.string().uuid().safeParse(orderId).success) return { error: "Pedido inválido." };

  const cleanReason = reason?.trim() || null;
  if (cleanReason && cleanReason.length > 300) return { error: "El motivo no puede superar los 300 caracteres." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_order_safe", { p_id: orderId, p_reason: cleanReason });

  if (error) {
    // P0001 = un `raise exception` en español escrito a propósito en la RPC.
    if (error.code === "P0001") return { error: error.message };
    console.error(JSON.stringify({ event: "order_delete_failed", orderId, errorCode: error.code, errorMessage: error.message }));
    return { error: "No se pudo eliminar el pedido." };
  }

  const row = (data as { human_code: string; storage_paths: string[] | null }[] | null)?.[0];
  const paths = row?.storage_paths ?? [];
  console.info(JSON.stringify({ event: "order_deleted", orderId, humanCode: row?.human_code, attachments: paths.length }));

  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from(ORDER_ATTACHMENTS_BUCKET).remove(paths);
    if (storageError) {
      console.error(
        JSON.stringify({
          event: "order_delete_storage_cleanup_failed",
          orderId,
          humanCode: row?.human_code,
          pathCount: paths.length,
          errorMessage: storageError.message,
        })
      );
    }
  }

  revalidatePath("/pedidos");
  revalidatePath(`/pedidos/${orderId}`);
  return {};
}
