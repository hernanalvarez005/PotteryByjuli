"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { paymentSchema } from "@/schemas/orders";
import { duePaymentSchema } from "@/schemas/workshops";
import { correctPaymentRow, loadPaymentHistory, type PaymentCorrectionEntry } from "@/lib/payment-corrections";

export type PaymentCorrectionState = { error?: string };

async function assertCanCorrectPayments() {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    throw new Error("No tenés permiso para corregir pagos.");
  }
  return user;
}

/**
 * "Corregir" desde cualquier lista de pagos (/pagos, ficha de cliente). El
 * origen (pedido o cuota de taller) se resuelve en el servidor leyendo el
 * propio pago — la pantalla nunca decide a qué padre pertenece. Es la misma
 * corrección que usan el detalle del pedido y la cuota: `correct_payment`.
 */
export async function correctPayment(
  paymentId: string,
  _prevState: PaymentCorrectionState,
  formData: FormData
): Promise<PaymentCorrectionState> {
  await assertCanCorrectPayments();

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("payments")
    .select("order_id,workshop_due_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (!target) return { error: "El pago no existe." };

  const raw = Object.fromEntries(formData.entries());
  const parsed = (target.order_id ? paymentSchema : duePaymentSchema).safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  const { reason, ...values } = parsed.data;
  const scope = target.order_id
    ? ({ column: "order_id", id: target.order_id as string } as const)
    : ({ column: "workshop_due_id", id: target.workshop_due_id as string } as const);
  const result = await correctPaymentRow(supabase, paymentId, scope, values, reason);
  if (result.error) return { error: result.error };

  revalidatePath("/pagos");
  revalidatePath("/pedidos");
  revalidatePath("/ventas");
  revalidatePath("/dashboard");
  revalidatePath("/reportes");
  revalidatePath("/clientes/[id]", "page");
  if (target.order_id) revalidatePath(`/pedidos/${target.order_id}`);
  else revalidatePath("/talleres", "layout");
  return {};
}

/** Historial de correcciones de un pago (se pide recién al abrirlo). */
export async function getPaymentHistory(paymentId: string): Promise<PaymentCorrectionEntry[]> {
  await requireUser();
  const supabase = await createClient();
  return loadPaymentHistory(supabase, paymentId);
}
