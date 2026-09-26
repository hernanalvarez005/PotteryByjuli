// Pure logic for monthly workshop dues — never assume "sin registro" means
// "pendiente" (sección 27), never store a derivable fact. "Pagada"/
// "Parcial" always come from summing real payments against a due, exactly
// like orders separate facturado from cobrado
// (docs/business-rules.md § Facturación ≠ cobranza).

export type DueDisplayStatus = "pending" | "partial" | "paid" | "cancelled" | "waived";

export const DUE_STATUS_LABELS: Record<DueDisplayStatus, string> = {
  pending: "Pendiente",
  partial: "Parcial",
  paid: "Pagada",
  cancelled: "Cancelada",
  // Exenta ≠ Pagada: no hubo pago (paid_total = 0), no suma ingreso y no es deuda.
  waived: "Exenta",
};

/**
 * `status` is only ever 'pending' or 'cancelled' in the database — the
 * only two states that aren't derivable from payments. This computes the
 * actual display status from that plus the real sum of linked payments.
 *
 * `baseWaived`: la cuota BASE tiene una exención activa (workshop_due_waivers).
 * `amount` ya es el total cobrable (cuota base efectiva + extras): con la base
 * exenta y nada más para cobrar (sin extras, o extras anulados) el total es 0 y
 * el estado es "Exenta" — nunca "Pagada" ni "Pendiente". Con extras cobrables
 * el estado se deriva de esos extras y los pagos, como siempre (la UI muestra
 * además que la base está exenta).
 */
export function computeDueDisplayStatus(
  storedStatus: "pending" | "cancelled",
  amount: number,
  paidAmount: number,
  baseWaived = false
): DueDisplayStatus {
  if (storedStatus === "cancelled") return "cancelled";
  if (baseWaived && amount <= 0) return "waived";
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
/** Un ciclo de exención (workshop_due_waivers): activo mientras `reverted_at` es null. */
export type DueWaiverLike = { reverted_at: string | null };

/** Select embebido que TODO consumidor de cuotas debe pedir para que la exención cuente. */
export const DUE_WAIVERS_SELECT = "workshop_due_waivers(reverted_at)";

/**
 * Select embebido con el historial COMPLETO de exenciones (quién, cuándo,
 * motivo, y quién/cuándo la quitó) — sólo lo piden las pantallas que muestran
 * el historial; el resto pide `DUE_WAIVERS_SELECT`.
 */
export const DUE_WAIVERS_DETAIL_SELECT =
  "workshop_due_waivers(id,waived_amount,reason,waived_at,reverted_at,revert_reason," +
  "waived_by_profile:profiles!workshop_due_waivers_waived_by_fkey(full_name,email)," +
  "reverted_by_profile:profiles!workshop_due_waivers_reverted_by_fkey(full_name,email))";

/** Perfil mínimo para mostrar quién hizo algo (`profiles.select authenticated`). */
export type ProfileNameLike = { full_name: string | null; email?: string | null } | null | undefined;

/**
 * Nombre a mostrar de quien eximió/quitó una exención: `full_name`, si está vacío
 * su email (ya viene en el mismo embed, sin otra consulta) y, si tampoco hay perfil,
 * "Usuario". Nunca queda en blanco ni un guion.
 */
export function profileDisplayName(profile: ProfileNameLike): string {
  return profile?.full_name?.trim() || profile?.email?.trim() || "Usuario";
}

/** Un ciclo de exención tal como lo devuelve DUE_WAIVERS_DETAIL_SELECT. */
export type DueWaiverRowRaw = {
  id: string;
  waived_amount: number;
  reason: string | null;
  waived_at: string;
  reverted_at: string | null;
  revert_reason: string | null;
  waived_by_profile: { full_name: string | null; email?: string | null } | null;
  reverted_by_profile: { full_name: string | null; email?: string | null } | null;
};

/** Ciclo listo para mostrar en el historial. */
export type DueWaiverHistoryItem = {
  id: string;
  waivedAmount: number;
  reason: string | null;
  waivedAt: string;
  /** Siempre un texto legible (nombre → email → "Usuario"). */
  waivedByName: string;
  /** `true` = exención vigente; `false` = ciclo CERRADO (se quitó). */
  active: boolean;
  revertedAt: string | null;
  /** Sólo hay nombre si el ciclo está cerrado. */
  revertedByName: string | null;
  revertReason: string | null;
};

/** Historial de exenciones de una cuota, del ciclo más reciente al más antiguo. */
export function toWaiverHistory(rows: DueWaiverRowRaw[] | null | undefined): DueWaiverHistoryItem[] {
  return [...(rows ?? [])]
    // Más reciente primero; ante un empate exacto de fecha, el ciclo vigente antes que el cerrado.
    .sort((a, b) => b.waived_at.localeCompare(a.waived_at) || Number(b.reverted_at == null) - Number(a.reverted_at == null))
    .map((w) => ({
      id: w.id,
      waivedAmount: w.waived_amount,
      reason: w.reason,
      waivedAt: w.waived_at,
      waivedByName: profileDisplayName(w.waived_by_profile),
      active: w.reverted_at == null,
      revertedAt: w.reverted_at,
      revertedByName: w.reverted_at == null ? null : profileDisplayName(w.reverted_by_profile),
      revertReason: w.revert_reason,
    }));
}

/** ¿Hay una exención activa de la cuota base? (a lo sumo una: índice único parcial). */
export function hasActiveWaiver(waivers: DueWaiverLike[] | null | undefined): boolean {
  return (waivers ?? []).some((w) => w.reverted_at == null);
}

export type DueSummary = {
  baseAmount: number;
  extrasTotal: number;
  /** Lo cobrable: (base exenta ? 0 : baseAmount) + extras no anulados. */
  totalDue: number;
  /** Pagos REALES — una exención nunca es un pago. */
  paidTotal: number;
  balance: number;
  status: DueDisplayStatus;
  /** La cuota base tiene una exención activa. */
  baseWaived: boolean;
  /** Importe base actualmente eximido (0 si no hay exención activa). */
  waivedAmount: number;
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
 *
 * EXENCIÓN (workshop_due_waivers): si la cuota base tiene una exención
 * activa, sólo la BASE deja de cobrarse — los extras siguen cobrables — y
 * `paidTotal` sigue siendo la suma de pagos reales (nunca un pago falso):
 * totalDue = (exenta ? 0 : base) + extras. La vista `workshop_due_balances`
 * replica exactamente esta regla en SQL.
 */
export function computeDueSummary(
  due: DueLike,
  items: DueItemLike[],
  payments: PaymentLike[],
  waivers: DueWaiverLike[] | null | undefined = []
): DueSummary {
  const baseAmount = due.amount;
  const baseWaived = hasActiveWaiver(waivers);
  const extrasTotal = items
    .filter((i) => i.voided_at == null)
    .reduce((sum, i) => sum + i.amount, 0);
  const totalDue = (baseWaived ? 0 : baseAmount) + extrasTotal;
  const paidTotal = payments.reduce((sum, p) => sum + p.amount, 0);
  return {
    baseAmount,
    extrasTotal,
    totalDue,
    paidTotal,
    balance: computeDueBalance(totalDue, paidTotal),
    status: computeDueDisplayStatus(due.status, totalDue, paidTotal, baseWaived),
    baseWaived,
    waivedAmount: baseWaived ? baseAmount : 0,
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
  dues: { period: string; status: "pending" | "cancelled"; amount: number; paidAmount: number; baseWaived?: boolean }[]
): string | null {
  // Una cuota exenta NO es un mes "pago": no hubo pago.
  const paidPeriods = dues
    .filter((d) => computeDueDisplayStatus(d.status, d.amount, d.paidAmount, d.baseWaived) === "paid")
    .map((d) => d.period);
  if (paidPeriods.length === 0) return null;
  return paidPeriods.sort().at(-1)!;
}

/** Último día calendario (AAAA-MM-DD) de un período "AAAA-MM". */
export function lastDayOfPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);
  // Día 0 del mes siguiente = último día de este mes.
  const d = new Date(Date.UTC(year, month, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** `waived`: la cuota base del período está exenta — ni deudora ni "paga". */
export type PeriodStatus = "paid" | "debtor" | "excluded" | "waived";

export type EnrollmentForPeriod = {
  id: string;
  status: "active" | "paused" | "cancelled";
  startDate: string; // yyyy-mm-dd
  /** Ya resuelta: enrollment.monthly_fee ?? group.monthly_fee. */
  monthlyFee: number | null;
};

/**
 * Auditoría "Ventas: fecha real, canal, comisiones y talleres" (G.1),
 * corrección aprobada: para un enrollment SIN ningún workshop_dues
 * generado en el período, "tiene monthly_fee configurada" nunca alcanza
 * sola — hace falta que, a la fecha, ya le tocara pagar. Sin una tabla de
 * historial de bajas, `status === 'active'` hoy es la única evidencia
 * disponible de que seguía inscripta; se documenta como limitación real,
 * no se inventa un dato que no existe. Confirmado con la usuaria: el mes
 * de alta se cobra completo, sin prorratear — por eso alcanza con
 * `startDate <= último día del período`, sin mirar el día exacto dentro
 * del mes.
 */
export function isEligibleWithoutDue(enrollment: EnrollmentForPeriod, period: string): boolean {
  return (
    enrollment.status === "active" &&
    enrollment.monthlyFee != null &&
    enrollment.startDate <= lastDayOfPeriod(period)
  );
}

/**
 * Clasifica un enrollment para un período — paga/deudora/excluida.
 * Cuando existe un due, reusa computeDueSummary tal cual (única fuente de
 * verdad de deuda, nunca una segunda lógica); cuando no existe ninguno,
 * aplica isEligibleWithoutDue en vez de mirar sólo si tiene tarifa.
 */
export function classifyForPeriod(
  enrollment: EnrollmentForPeriod,
  period: string,
  // Sólo lo que hace falta mirar — cualquier DueSummary ya calculado
  // (dues-panel.tsx, la ficha de grupo) satisface esta forma tal cual.
  due: { status: DueDisplayStatus; balance: number } | null
): PeriodStatus {
  if (due) {
    if (due.status === "cancelled") return "excluded";
    if (due.status === "waived") return "waived";
    return due.balance <= 0 ? "paid" : "debtor";
  }
  return isEligibleWithoutDue(enrollment, period) ? "debtor" : "excluded";
}
