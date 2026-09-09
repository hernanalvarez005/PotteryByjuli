import { z } from "zod";

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

const optionalUuid = z
  .string()
  .trim()
  .uuid()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

// Slugs are the public URL (/workshops/[slug]) — keep them boring and safe:
// lowercase letters, numbers, single hyphens, no leading/trailing hyphen.
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Usá minúsculas, números y guiones (sin espacios).");

export const eventSchema = z.object({
  event_type: z.enum(["workshop", "fair"]),
  name: z.string().trim().min(1, "Requerido").max(160),
  slug: slugSchema.optional().or(z.literal("")).transform((v) => (v ? v : null)),
  description: optionalText(2000),
  location_id: optionalUuid,
  address: optionalText(200),
  event_date: z.string().trim().min(1, "Requerido"),
  start_time: optionalText(8),
  end_time: optionalText(8),
  schedule: optionalText(120),
  capacity: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v > 0), "Cupo inválido"),
  price: optionalMoney,
  cost_estimate: optionalMoney,
  payment_account_id: optionalUuid,
  additional_info: optionalText(2000),
  is_registration_open: z
    .union([z.literal("on"), z.literal("false"), z.literal("")])
    .optional()
    .transform((v) => v === "on"),
  notes: optionalText(1000),
});

export const registrationSchema = z.object({
  customer_id: z.string().trim().uuid(),
  participant_name: optionalText(120),
  quantity: z
    .string()
    .trim()
    .min(1)
    .transform((v) => Number(v))
    .refine((v) => Number.isInteger(v) && v > 0, "Cantidad inválida"),
});

export const publicRegistrationSchema = z.object({
  first_name: z.string().trim().min(1, "Falta el nombre.").max(80),
  last_name: optionalText(80),
  whatsapp: z.string().trim().min(6, "Falta un WhatsApp de contacto.").max(30),
  email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, "Email inválido.")
    .transform((v) => (v ? v : null)),
  participant_name: optionalText(120),
  notes: optionalText(500),
});

export const EVENT_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  published: "Publicado",
  full: "Cupo completo",
  completed: "Realizado",
  cancelled: "Cancelado",
  archived: "Archivado",
};

export const REGISTRATION_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  attended: "Asistió",
  no_show: "No asistió",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  partial: "Parcial",
  paid: "Pagado",
};
