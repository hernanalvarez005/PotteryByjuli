import { z } from "zod";
import { optionalString } from "@/lib/zod-helpers";

export const specialDateSchema = z.object({
  title: z.string().trim().min(1, "Requerido").max(160),
  date: z.string().trim().min(1, "Requerido"),
  description: optionalString(500),
  category: optionalString(60),
  // Un checkbox sin marcar directamente no aparece en FormData —
  // formData.get("recurs_yearly") devuelve `null`, no "" — mismo patrón
  // null-vs-string que optionalString/optionalUuid existen para prevenir
  // (lib/zod-helpers.ts), acá aplicado a un checkbox en vez de un campo
  // de texto.
  recurs_yearly: z
    .preprocess(
      (v) => (v === null || v === undefined ? "" : v),
      z.union([z.literal("on"), z.literal("false"), z.literal("")])
    )
    .transform((v) => v === "on"),
});
