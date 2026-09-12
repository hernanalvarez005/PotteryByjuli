import { z } from "zod";
import { optionalString, optionalUuid, optionalInteger, optionalMoneyAmount } from "@/lib/zod-helpers";

export const programSchema = z.object({
  name: z.string().trim().min(1, "Requerido").max(120),
  description: optionalString(1000),
});

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};

export const groupSchema = z.object({
  program_id: z.string().trim().uuid(),
  name: z.string().trim().min(1, "Requerido").max(120),
  schedule: optionalString(120),
  weekday: optionalInteger(1).refine((v) => v === null || v <= 7, "Día inválido"),
  start_time: optionalString(8),
  end_time: optionalString(8),
  location_id: optionalUuid(),
  capacity: z
    .string()
    .trim()
    .min(1, "Requerido")
    .transform((v) => Number(v))
    .refine((v) => Number.isInteger(v) && v > 0, "Cupo inválido"),
  monthly_fee: optionalMoneyAmount(),
});

/** Editing just the monthly fee on an existing group — its own tiny schema
 * so the edit dialog doesn't have to resend every other group field. */
export const groupMonthlyFeeSchema = z.object({
  monthly_fee: optionalMoneyAmount(),
});

export const enrollmentSchema = z.object({
  customer_id: z.string().trim().uuid(),
  monthly_fee: optionalMoneyAmount(),
});

export const dueSchema = z.object({
  period: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "Formato esperado AAAA-MM"),
  amount: z
    .string()
    .trim()
    .min(1, "Requerido")
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v >= 0, "Importe inválido"),
  due_date: optionalString(10),
});

export const duePaymentSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Requerido")
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v > 0, "Importe inválido"),
  // Siempre explícito — mismo contrato que schemas/orders.ts paymentSchema.
  paid_at: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  method_id: optionalUuid(),
  // El formulario de dues-panel.tsx nunca renderizó un campo Cuenta — sin
  // el preprocesamiento null-safe de optionalUuid(), formData.get("account_id")
  // devuelve `null` (campo ausente, no ""), y el patrón viejo
  // `.optional().or(z.literal(""))` no tolera un `null` crudo: falla con
  // el "Invalid input" genérico de Zod. Mismo bug real encontrado en
  // schemas/orders.ts § delivery_address (2026-09-10).
  account_id: optionalUuid(),
  reference: optionalString(200),
  // Nota de corrección (sección 14 de la tanda de usabilidad) — separada
  // de `reference` (que es una referencia de la transacción, no una nota
  // de por qué se corrigió el pago).
  notes: optionalString(500),
});

// Cargo extra sobre una cuota (sección 6) — nunca un payment, un monto que
// se SUMA a lo que se debe.
export const dueExtraSchema = z.object({
  concept_id: z.string().trim().uuid("Elegí un concepto"),
  amount: z
    .string()
    .trim()
    .min(1, "Requerido")
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v > 0, "Importe inválido"),
  note: optionalString(200),
});

export const ATTENDANCE_LABELS: Record<string, string> = {
  present: "Presente",
  absent: "Ausente",
  notified_absence: "Avisó",
};
