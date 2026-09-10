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
  business_whatsapp: optionalString(30),
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
  last_name: requiredString(z.string().trim().min(1, "Falta el apellido.").max(80)),
  company_name: requiredString(
    z.string().trim().min(1, "Falta la razón social o el nombre del comercio.").max(120)
  ),
  cuit: optionalString(20),
  instagram: optionalString(60),
  website: optionalString(160),
  city: requiredString(z.string().trim().min(1, "Falta la ciudad.").max(80)),
  province: requiredString(z.string().trim().min(1, "Falta la provincia.").max(80)),
  address: optionalString(160),
  postal_code: optionalString(20),
  whatsapp: requiredString(z.string().trim().min(6, "Falta un WhatsApp de contacto.").max(30)),
  email: requiredString(
    z.string().trim().min(1, "Falta el email.").max(160).email("Ingresá un email válido.")
  ),
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
