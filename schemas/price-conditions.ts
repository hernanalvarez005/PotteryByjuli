import { z } from "zod";
import { requiredString } from "@/lib/zod-helpers";

// Alta de una condición de precio (Bloque 3 — "Próxima evolución
// operativa"). El código se deriva del nombre en el server action
// (lib/slug.ts), nunca lo escribe la usuaria a mano — evita el típico
// "efectivo" vs "Efectivo " vs "EFECTIVO" duplicado por typo.
export const createPriceConditionSchema = z.object({
  name: requiredString(z.string().trim().min(1, "Falta el nombre.").max(80)),
  payment_method_ids: z.array(z.string().trim().uuid()).default([]),
});

export type CreatePriceConditionInput = z.infer<typeof createPriceConditionSchema>;
