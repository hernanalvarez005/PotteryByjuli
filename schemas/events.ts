import { z } from "zod";
import { optionalString, optionalUuid, optionalMoneyAmount, optionalInteger } from "@/lib/zod-helpers";

// Slugs are the public URL (/workshops/[slug]) — keep them boring and safe:
// lowercase letters, numbers, single hyphens, no leading/trailing hyphen.
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Usá minúsculas, números y guiones (sin espacios).");

// Un checkbox sin marcar no aparece en FormData en absoluto —
// formData.get("is_registration_open") devuelve `null`, no "" — mismo
// patrón null-vs-string que optionalString/optionalUuid existen para
// prevenir (lib/zod-helpers.ts), acá aplicado a un checkbox.
const optionalCheckbox = z
  .preprocess(
    (v) => (v === null || v === undefined ? "" : v),
    z.union([z.literal("on"), z.literal("false"), z.literal("")])
  )
  .transform((v) => v === "on");

export const eventSchema = z.object({
  event_type: z.enum(["workshop", "fair"]),
  name: z.string().trim().min(1, "Requerido").max(160),
  slug: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    slugSchema.optional()
  ).transform((v) => v ?? null),
  description: optionalString(2000),
  location_id: optionalUuid(),
  address: optionalString(200),
  event_date: z.string().trim().min(1, "Requerido"),
  start_time: optionalString(8),
  end_time: optionalString(8),
  schedule: optionalString(120),
  capacity: optionalInteger(1).refine((v) => v === null || v > 0, "Cupo inválido"),
  price: optionalMoneyAmount(),
  cost_estimate: optionalMoneyAmount(),
  payment_account_id: optionalUuid(),
  additional_info: optionalString(2000),
  is_registration_open: optionalCheckbox,
  notes: optionalString(1000),
});

export const registrationSchema = z.object({
  customer_id: z.string().trim().uuid(),
  participant_name: optionalString(120),
  quantity: z
    .string()
    .trim()
    .min(1)
    .transform((v) => Number(v))
    .refine((v) => Number.isInteger(v) && v > 0, "Cantidad inválida"),
});

export const publicRegistrationSchema = z.object({
  first_name: z.string().trim().min(1, "Falta el nombre.").max(80),
  last_name: optionalString(80),
  whatsapp: z.string().trim().min(6, "Falta un WhatsApp de contacto.").max(30),
  email: z
    .preprocess(
      (v) => (v === null || v === undefined || v === "" ? undefined : v),
      z.string().trim().max(160).optional()
    )
    .refine((v) => v === undefined || z.string().email().safeParse(v).success, "Email inválido.")
    .transform((v) => v ?? null),
  participant_name: optionalString(120),
  notes: optionalString(500),
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
