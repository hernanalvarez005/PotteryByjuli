// Pure logic for monthly workshop dues — never assume "sin registro" means
// "pendiente" (sección 27), never store a derivable fact. "Pagada"/
// "Parcial" always come from summing real payments against a due, exactly
// like orders separate facturado from cobrado
// (docs/business-rules.md § Facturación ≠ cobranza).

export type DueDisplayStatus = "pending" | "partial" | "paid" | "cancelled";

export const DUE_STATUS_LABELS: Record<DueDisplayStatus, string> = {
  pending: "Pendiente",
  partial: "Parcial",
  paid: "Pagada",
  cancelled: "Cancelada",
};

/**
 * `status` is only ever 'pending' or 'cancelled' in the database — the
 * only two states that aren't derivable from payments. This computes the
 * actual display status from that plus the real sum of linked payments.
 */
export function computeDueDisplayStatus(
  storedStatus: "pending" | "cancelled",
  amount: number,
  paidAmount: number
): DueDisplayStatus {
  if (storedStatus === "cancelled") return "cancelled";
  if (paidAmount <= 0) return "pending";
  if (paidAmount >= amount) return "paid";
  return "partial";
}

export function computeDueBalance(amount: number, paidAmount: number): number {
  return Math.max(0, amount - paidAmount);
}

export type DueLike = { status: "pending" | "cancelled"; amount: number };
export type DueItemLike = { amount: number; voided_at: string | null };
export type PaymentLike = { amount: number };

export type DueSummary = {
  baseAmount: number;
  extrasTotal: number;
  totalDue: number;
  paidTotal: number;
  balance: number;
  status: DueDisplayStatus;
};

/**
 * Única fuente de verdad para el total de una cuota (precisión de la
 * usuaria en la tanda de mejoras operativas — sección 7): Talleres, la
 * ficha de alumna, el dashboard y los reportes llaman TODOS a esta misma
 * función, nunca reimplementan la suma por su cuenta — mismo fixture,
 * mismo resultado en cualquier consumidor (ver
 * lib/workshop-dues-consumers.test.ts).
 *
 * baseAmount viene de workshop_dues.amount (snapshot histórico de la
 * cuota mensual); extrasTotal suma los workshop_due_items NO anulados
 * (sección 6); totalDue es la suma de ambos. El estado se deriva contra
 * totalDue, no sólo baseAmount — así que agregar un extra a una cuota que
 * hoy figura "Pagada" la vuelve "Parcial" automáticamente, sin ningún
 * caso especial: el estado siempre se deriva, nunca se guarda.
 */
export function computeDueSummary(
  due: DueLike,
  items: DueItemLike[],
  payments: PaymentLike[]
): DueSummary {
  const baseAmount = due.amount;
  const extrasTotal = items
    .filter((i) => i.voided_at == null)
    .reduce((sum, i) => sum + i.amount, 0);
  const totalDue = baseAmount + extrasTotal;
  const paidTotal = payments.reduce((sum, p) => sum + p.amount, 0);
  return {
    baseAmount,
    extrasTotal,
    totalDue,
    paidTotal,
    balance: computeDueBalance(totalDue, paidTotal),
    status: computeDueDisplayStatus(due.status, totalDue, paidTotal),
  };
}

/** Current calendar period in the "AAAA-MM" format workshop_dues.period expects. */
export function currentPeriod(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousPeriod(period: string): string {
  return shiftPeriod(period, -1);
}

export function nextPeriod(period: string): string {
  return shiftPeriod(period, 1);
}

const PERIOD_LABELS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-09" -> "Septiembre 2026" */
export function formatPeriodLabel(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const [, year, month] = match;
  const label = PERIOD_LABELS[Number(month) - 1];
  if (!label) return period;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${year}`;
}

/**
 * Finds the most recent period with at least one due whose display status
 * is "paid" — sección 28's "Último mes pago", computed from real dues,
 * never guessed. Periods sort lexicographically since they're all
 * "AAAA-MM" — no date parsing needed.
 */
export function lastPaidPeriod(
  dues: { period: string; status: "pending" | "cancelled"; amount: number; paidAmount: number }[]
): string | null {
  const paidPeriods = dues
    .filter((d) => computeDueDisplayStatus(d.status, d.amount, d.paidAmount) === "paid")
    .map((d) => d.period);
  if (paidPeriods.length === 0) return null;
  return paidPeriods.sort().at(-1)!;
}
