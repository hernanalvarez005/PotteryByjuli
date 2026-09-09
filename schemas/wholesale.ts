import { z } from "zod";

const optionalInt = (min = 1) =>
  z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= min), "Número inválido");

const optionalMoney = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? Number(v) : null))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Importe inválido");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null));

export const wholesaleSettingsSchema = z.object({
  min_order_amount: optionalMoney,
  min_total_units: optionalInt(1),
  lead_time_min_days: optionalInt(1),
  lead_time_max_days: optionalInt(1),
  payment_terms: optionalText(500),
  shipping_terms: optionalText(500),
  commercial_message: optionalText(1000),
});

export const wholesaleRulesSchema = z.object({
  is_public: z
    .union([z.literal("on"), z.literal("false"), z.literal("")])
    .optional()
    .transform((v) => v === "on"),
  min_quantity: optionalInt(1),
  multiple_of: optionalInt(1),
  lead_time_days: optionalInt(1),
});

const optionalPublicText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const wholesaleRequestFormSchema = z.object({
  first_name: z.string().trim().min(1, "Falta el nombre.").max(80),
  last_name: optionalPublicText(80),
  company_name: optionalPublicText(120),
  cuit: optionalPublicText(20),
  instagram: optionalPublicText(60),
  website: optionalPublicText(160),
  city: optionalPublicText(80),
  province: optionalPublicText(80),
  whatsapp: z.string().trim().min(6, "Falta un WhatsApp de contacto.").max(30),
  email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, "Email inválido.")
    .transform((v) => (v ? v : null)),
  notes: optionalPublicText(1000),
});

export type WholesaleRequestFormInput = z.infer<typeof wholesaleRequestFormSchema>;

export type WholesaleCartItem = {
  productVariantId: string;
  productName: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
  minQuantity: number | null;
  multipleOf: number | null;
  imageUrl: string | null;
};
