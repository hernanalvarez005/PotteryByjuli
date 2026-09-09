import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null));

export const customerSchema = z.object({
  first_name: z.string().trim().min(1, "Requerido").max(80),
  last_name: optionalText(80),
  whatsapp: optionalText(30),
  email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || z.string().email().safeParse(v).success, {
      message: "Email inválido.",
    })
    .transform((v) => (v ? v : null)),
  dni: optionalText(20),
  cuit: optionalText(20),
  company_name: optionalText(120),
  instagram: optionalText(60),
  website: optionalText(160),
  city: optionalText(80),
  province: optionalText(80),
});

export type CustomerInput = z.infer<typeof customerSchema>;

export const customerNoteSchema = z.object({
  note: z.string().trim().min(1, "Escribí algo.").max(2000),
});
