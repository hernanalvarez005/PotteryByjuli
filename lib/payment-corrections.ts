import type { SupabaseClient } from "@supabase/supabase-js";
import { dateOnlyToArgentinaNoonISO, isoToArgentinaDate } from "@/lib/format";

// Corrección de pagos (pedidos/ventas y cuotas de taller comparten esto).
//
// Un pago se corrige EN EL LUGAR (nunca delete + recrear): la fila real se
// actualiza vía el RPC `correct_payment` y el trigger `payments_log_correction`
// deja en `payment_corrections` qué cambió, quién, cuándo y por qué. Saldo,
// KPI y reportes se recalculan solos porque todo se deriva de `payments`.
//
// Contrato del patch: sólo viajan las CLAVES que realmente cambiaron. En
// particular `paid_at` NO viaja si la fecha elegida es el mismo día
// (Argentina) que ya tenía el pago — así corregir un importe no mueve la
// hora real del cobro ni ensucia el historial con un "cambio" de fecha que
// no existió.

export const PAYMENT_CORRECTION_FIELDS = [
  "amount",
  "paid_at",
  "method_id",
  "account_id",
  "reference",
  "notes",
  "fee_amount",
] as const;
export type PaymentCorrectionField = (typeof PAYMENT_CORRECTION_FIELDS)[number];

export const PAYMENT_FIELD_LABELS: Record<PaymentCorrectionField, string> = {
  amount: "Importe",
  paid_at: "Fecha del pago",
  method_id: "Medio de pago",
  account_id: "Cuenta",
  reference: "Referencia",
  notes: "Notas",
  fee_amount: "Comisión",
};

/** Lo que hoy tiene el pago guardado. */
export type PaymentSnapshot = {
  amount: number;
  paid_at: string;
  method_id: string | null;
  account_id: string | null;
  reference: string | null;
  notes: string | null;
  fee_amount: number;
};

/** Lo que llega del formulario ya validado (`paid_at` es una fecha YYYY-MM-DD). */
export type PaymentFormValues = Omit<PaymentSnapshot, "paid_at"> & { paid_at: string };

export type PaymentPatch = Partial<{
  amount: number;
  paid_at: string;
  method_id: string | null;
  account_id: string | null;
  reference: string | null;
  notes: string | null;
  fee_amount: number;
}>;

const norm = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/** Diferencia mínima entre el pago guardado y lo que mandó el formulario. */
export function buildPaymentPatch(current: PaymentSnapshot, input: PaymentFormValues): PaymentPatch {
  const patch: PaymentPatch = {};
  if (Number(input.amount) !== Number(current.amount)) patch.amount = input.amount;
  if (Number(input.fee_amount) !== Number(current.fee_amount)) patch.fee_amount = input.fee_amount;
  if (input.paid_at !== isoToArgentinaDate(current.paid_at)) {
    patch.paid_at = dateOnlyToArgentinaNoonISO(input.paid_at);
  }
  if ((input.method_id ?? null) !== (current.method_id ?? null)) patch.method_id = input.method_id ?? null;
  if ((input.account_id ?? null) !== (current.account_id ?? null)) patch.account_id = input.account_id ?? null;
  if (norm(input.reference) !== norm(current.reference)) patch.reference = norm(input.reference);
  if (norm(input.notes) !== norm(current.notes)) patch.notes = norm(input.notes);
  return patch;
}

const RPC_ERROR_PASSTHROUGH = [
  "No hay cambios para guardar.",
  "El importe tiene que ser mayor a 0.",
  "La comisión no puede ser mayor al importe del pago.",
  "El motivo no puede superar los 300 caracteres.",
  "La referencia no puede superar los 200 caracteres.",
  "La nota no puede superar los 500 caracteres.",
  "El pago no existe.",
  "No tenés permiso para corregir pagos.",
];

export type CorrectPaymentResult = { error?: string };

/**
 * Lee el pago (acotado a su padre: `order_id` o `workshop_due_id`, para que una
 * pantalla nunca corrija un pago que no es suyo), arma el patch mínimo y llama
 * a `correct_payment`. Devuelve un mensaje en castellano si algo falla.
 */
export async function correctPaymentRow(
  supabase: SupabaseClient,
  paymentId: string,
  scope: { column: "order_id" | "workshop_due_id"; id: string } | null,
  input: PaymentFormValues,
  reason: string | null
): Promise<CorrectPaymentResult> {
  let query = supabase
    .from("payments")
    .select("amount,paid_at,method_id,account_id,reference,notes,fee_amount")
    .eq("id", paymentId);
  if (scope) query = query.eq(scope.column, scope.id);
  const { data: current, error: readError } = await query.maybeSingle();
  if (readError) return { error: "No se pudo leer el pago." };
  if (!current) return { error: "El pago no existe." };

  const patch = buildPaymentPatch(
    { ...current, amount: Number(current.amount), fee_amount: Number(current.fee_amount) } as PaymentSnapshot,
    input
  );
  if (Object.keys(patch).length === 0) return { error: "No hay cambios para guardar." };

  const { error } = await supabase.rpc("correct_payment", {
    p_payment_id: paymentId,
    p_changes: patch,
    p_reason: reason,
  });
  if (error) {
    const known = RPC_ERROR_PASSTHROUGH.find((m) => error.message.includes(m));
    return { error: known ?? "No se pudo corregir el pago." };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Historial visible
// ---------------------------------------------------------------------------

export type PaymentCorrectionRow = {
  id: string;
  changed_at: string;
  changed_by: string | null;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  reason: string | null;
};

export type PaymentCorrectionChange = { field: PaymentCorrectionField; label: string; from: string; to: string };

export type PaymentCorrectionEntry = {
  id: string;
  changedAt: string;
  changedByName: string | null;
  reason: string | null;
  changes: PaymentCorrectionChange[];
};

type Lookups = { methods: Map<string, string>; accounts: Map<string, string> };

function displayValue(field: PaymentCorrectionField, value: unknown, lookups: Lookups): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (field) {
    case "amount":
    case "fee_amount":
      return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(value));
    case "paid_at":
      return isoToArgentinaDate(String(value)).split("-").reverse().join("/");
    case "method_id":
      return lookups.methods.get(String(value)) ?? "(medio eliminado)";
    case "account_id":
      return lookups.accounts.get(String(value)) ?? "(cuenta eliminada)";
    default:
      return String(value);
  }
}

/** Convierte una fila cruda de `payment_corrections` en cambios legibles (sólo lo que cambió). */
export function describeCorrection(
  row: PaymentCorrectionRow,
  lookups: Lookups,
  changedByName: string | null
): PaymentCorrectionEntry {
  const prev = row.previous_values ?? {};
  const next = row.new_values ?? {};
  const changes: PaymentCorrectionChange[] = [];
  for (const field of PAYMENT_CORRECTION_FIELDS) {
    const a = prev[field];
    const b = next[field];
    const same =
      a == null && b == null
        ? true
        : field === "amount" || field === "fee_amount"
          ? Number(a) === Number(b)
        : field === "paid_at"
          ? a != null && b != null && new Date(String(a)).getTime() === new Date(String(b)).getTime()
          : (a ?? null) === (b ?? null);
    if (same) continue;
    changes.push({
      field,
      label: PAYMENT_FIELD_LABELS[field],
      from: displayValue(field, a, lookups),
      to: displayValue(field, b, lookups),
    });
  }
  return { id: row.id, changedAt: row.changed_at, changedByName, reason: row.reason, changes };
}

/** Historial de un pago, más reciente primero, con nombres resueltos. */
export async function loadPaymentHistory(
  supabase: SupabaseClient,
  paymentId: string
): Promise<PaymentCorrectionEntry[]> {
  const { data: rows } = await supabase
    .from("payment_corrections")
    .select("id,changed_at,changed_by,previous_values,new_values,reason")
    .eq("payment_id", paymentId)
    .order("changed_at", { ascending: false })
    .limit(50);
  const list = (rows ?? []) as PaymentCorrectionRow[];
  if (list.length === 0) return [];

  const userIds = [...new Set(list.map((r) => r.changed_by).filter((v): v is string => Boolean(v)))];
  const [{ data: profiles }, { data: methods }, { data: accounts }] = await Promise.all([
    userIds.length
      ? supabase.from("profiles").select("id,full_name,email").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
    supabase.from("payment_methods").select("id,name"),
    supabase.from("payment_accounts").select("id,name"),
  ]);
  const names = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name || p.email || null) as string | null]));
  const lookups: Lookups = {
    methods: new Map((methods ?? []).map((m) => [m.id as string, m.name as string])),
    accounts: new Map((accounts ?? []).map((a) => [a.id as string, a.name as string])),
  };
  return list.map((r) => describeCorrection(r, lookups, r.changed_by ? (names.get(r.changed_by) ?? null) : null));
}
