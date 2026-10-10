import type { EditablePayment } from "@/components/payment-edit-form";

// Forma común de una fila de pago en las listas (/pagos, ficha del cliente):
// de dónde viene (pedido/venta o cuota de taller) y de quién (cliente o
// alumna), más los campos que el formulario de corrección necesita.

export const PAYMENT_LIST_SELECT =
  "id,amount,paid_at,method_id,account_id,reference,notes,fee_amount,order_id,workshop_due_id," +
  "orders(id,human_code,customers(id,first_name,last_name))," +
  "workshop_dues(id,period,workshop_enrollments(customers(id,first_name,last_name),workshop_groups(id,name)))," +
  "payment_methods(name),payment_accounts(name)";

type PersonRaw = { id: string; first_name: string; last_name: string | null } | null;

type RawPaymentRow = EditablePayment & {
  order_id: string | null;
  workshop_due_id: string | null;
  orders: { id: string; human_code: string; customers: PersonRaw } | null;
  workshop_dues: {
    id: string;
    period: string;
    workshop_enrollments: {
      customers: PersonRaw;
      workshop_groups: { id: string; name: string } | null;
    } | null;
  } | null;
  payment_methods: { name: string } | null;
  payment_accounts: { name: string } | null;
};

export type PaymentOrigin =
  | { kind: "order"; orderId: string; code: string }
  | { kind: "due"; groupId: string | null; groupName: string; period: string }
  | { kind: "unknown" };

export type PaymentListRow = {
  payment: EditablePayment;
  origin: PaymentOrigin;
  person: { id: string; name: string; isStudent: boolean } | null;
  methodName: string | null;
  accountName: string | null;
};

const fullName = (p: NonNullable<PersonRaw>) => [p.first_name, p.last_name].filter(Boolean).join(" ");

/** Normaliza lo que devuelve PostgREST (relaciones to-one a veces vienen como arreglo). */
export function toPaymentListRow(input: unknown): PaymentListRow {
  const raw = input as RawPaymentRow;
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

  const order = one(raw.orders);
  const due = one(raw.workshop_dues);
  const enrollment = due ? one(due.workshop_enrollments) : null;
  const group = enrollment ? one(enrollment.workshop_groups) : null;

  let origin: PaymentOrigin = { kind: "unknown" };
  let personRaw: PersonRaw = null;
  let isStudent = false;
  if (order) {
    origin = { kind: "order", orderId: order.id, code: order.human_code };
    personRaw = one(order.customers);
  } else if (due) {
    origin = { kind: "due", groupId: group?.id ?? null, groupName: group?.name ?? "Taller", period: due.period };
    personRaw = enrollment ? one(enrollment.customers) : null;
    isStudent = true;
  }

  return {
    payment: {
      id: raw.id,
      amount: Number(raw.amount),
      paid_at: raw.paid_at,
      method_id: raw.method_id,
      account_id: raw.account_id,
      reference: raw.reference,
      notes: raw.notes,
      fee_amount: Number(raw.fee_amount),
    },
    origin,
    person: personRaw ? { id: personRaw.id, name: fullName(personRaw), isStudent } : null,
    methodName: one(raw.payment_methods)?.name ?? null,
    accountName: one(raw.payment_accounts)?.name ?? null,
  };
}
