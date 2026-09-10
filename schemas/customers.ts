import { z } from "zod";
import { optionalString } from "@/lib/zod-helpers";

export const customerSchema = z.object({
  first_name: z.string().trim().min(1, "Requerido").max(80),
  last_name: optionalString(80),
  whatsapp: optionalString(30),
  email: z
    .preprocess(
      (v) => (v === null || v === undefined || v === "" ? undefined : v),
      z.string().trim().max(160).optional()
    )
    .refine((v) => v === undefined || z.string().email().safeParse(v).success, {
      message: "Email inválido.",
    })
    .transform((v) => v ?? null),
  dni: optionalString(20),
  cuit: optionalString(20),
  company_name: optionalString(120),
  instagram: optionalString(60),
  website: optionalString(160),
  city: optionalString(80),
  province: optionalString(80),
});

export type CustomerInput = z.infer<typeof customerSchema>;

export const customerNoteSchema = z.object({
  note: z.string().trim().min(1, "Escribí algo.").max(2000),
});
