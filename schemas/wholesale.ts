import { z } from "zod";
import { optionalString, optionalInteger, optionalMoneyAmount, requiredString } from "@/lib/zod-helpers";

export const wholesaleSettingsSchema = z.object({
  min_order_amount: optionalMoneyAmount(),
  min_total_units: optionalInteger(1),
  lead_time_min_days: optionalInteger(1),
  lead_time_max_days: optionalInteger(1),
  payment_terms: optionalString(500),
  shipping_terms: optionalString(500),
  commercial_message: optionalString(1000),
});

export const wholesaleRulesSchema = z.object({
  is_public: z
    .union([z.literal("on"), z.literal("false"), z.literal("")])
    .optional()
    .transform((v) => v === "on"),
  min_quantity: optionalInteger(1),
  multiple_of: optionalInteger(1),
  lead_time_days: optionalInteger(1),
});

export const wholesaleRequestFormSchema = z.object({
  first_name: requiredString(z.string().trim().min(1, "Falta el nombre.").max(80)),
  last_name: optionalString(80),
  company_name: optionalString(120),
  cuit: optionalString(20),
  instagram: optionalString(60),
  website: optionalString(160),
  city: optionalString(80),
  province: optionalString(80),
  whatsapp: requiredString(z.string().trim().min(6, "Falta un WhatsApp de contacto.").max(30)),
  email: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.string().trim().max(160).optional()
  )
    .refine((v) => !v || z.string().email().safeParse(v).success, "Email inválido.")
    .transform((v) => v ?? null),
  notes: optionalString(1000),
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
