import { z } from "zod";

const optionalUuid = z
  .string()
  .trim()
  .uuid()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

export const expenseSchema = z.object({
  expense_date: z.string().trim().min(1, "Requerido"),
  category_id: optionalUuid,
  concept: z.string().trim().min(1, "Requerido").max(200),
  vendor: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  amount: z
    .string()
    .trim()
    .min(1, "Requerido")
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v > 0, "Importe inválido"),
  method_id: optionalUuid,
  account_id: optionalUuid,
  business_unit_id: optionalUuid,
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
});

export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Requerido").max(160),
  start_date: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  end_date: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  objective: z
    .string()
    .trim()
    .max(300)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  investment: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Importe inválido"),
});
