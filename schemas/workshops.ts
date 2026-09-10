import { z } from "zod";

export const programSchema = z.object({
  name: z.string().trim().min(1, "Requerido").max(120),
  description: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
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
  schedule: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  weekday: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 7), "Día inválido"),
  start_time: z
    .string()
    .trim()
    .max(8)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  end_time: z
    .string()
    .trim()
    .max(8)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  location_id: z
    .string()
    .trim()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  capacity: z
    .string()
    .trim()
    .min(1, "Requerido")
    .transform((v) => Number(v))
    .refine((v) => Number.isInteger(v) && v > 0, "Cupo inválido"),
  monthly_fee: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Importe inválido"),
});

/** Editing just the monthly fee on an existing group — its own tiny schema
 * so the edit dialog doesn't have to resend every other group field. */
export const groupMonthlyFeeSchema = z.object({
  monthly_fee: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Importe inválido"),
});

export const enrollmentSchema = z.object({
  customer_id: z.string().trim().uuid(),
  monthly_fee: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Importe inválido"),
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
  due_date: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
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
  method_id: z
    .string()
    .trim()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  account_id: z
    .string()
    .trim()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  reference: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
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
  note: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
});

export const ATTENDANCE_LABELS: Record<string, string> = {
  present: "Presente",
  absent: "Ausente",
  notified_absence: "Avisó",
};
