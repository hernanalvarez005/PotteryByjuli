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
  period: z.string().trim().min(1, "Requerido").max(20),
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

export const ATTENDANCE_LABELS: Record<string, string> = {
  present: "Presente",
  absent: "Ausente",
  notified_absence: "Avisó",
};
