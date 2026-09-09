import { z } from "zod";

export const specialDateSchema = z.object({
  title: z.string().trim().min(1, "Requerido").max(160),
  date: z.string().trim().min(1, "Requerido"),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  category: z
    .string()
    .trim()
    .max(60)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  recurs_yearly: z
    .union([z.literal("on"), z.literal("false"), z.literal("")])
    .optional()
    .transform((v) => v === "on"),
});
