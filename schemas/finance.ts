import { z } from "zod";
import { optionalString, optionalUuid, optionalMoneyAmount } from "@/lib/zod-helpers";

export const expenseSchema = z.object({
  expense_date: z.string().trim().min(1, "Requerido"),
  category_id: optionalUuid(),
  concept: z.string().trim().min(1, "Requerido").max(200),
  vendor: optionalString(120),
  amount: z
    .string()
    .trim()
    .min(1, "Requerido")
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v > 0, "Importe inválido"),
  method_id: optionalUuid(),
  account_id: optionalUuid(),
  business_unit_id: optionalUuid(),
  notes: optionalString(500),
});

// Otros ingresos (Bloque 6) — a propósito no tiene business_unit_id ni
// category_id: no pertenece a ninguna unidad del catálogo (ver
// migración income_entries) y la categoría es texto libre para el MVP.
export const incomeEntrySchema = z.object({
  concept: z.string().trim().min(1, "Requerido").max(200),
  category: optionalString(80),
  amount: z
    .string()
    .trim()
    .min(1, "Requerido")
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v > 0, "Importe inválido"),
  occurred_at: z.string().trim().min(1, "Requerido"),
  method_id: optionalUuid(),
  account_id: optionalUuid(),
  location_id: optionalUuid(),
  counterparty: optionalString(120),
  notes: optionalString(500),
});

export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Requerido").max(160),
  start_date: optionalString(10),
  end_date: optionalString(10),
  objective: optionalString(300),
  investment: optionalMoneyAmount(),
});
