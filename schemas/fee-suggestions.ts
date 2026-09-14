import { z } from "zod";
import { optionalUuid } from "@/lib/zod-helpers";

// payment_method_fee_suggestions — sólo lo que la venta rápida necesita
// para mostrar una comisión estimada antes de cobrar (D.1/Bloque 3).
// Nunca lo que se guarda como fee real de un pago: eso siempre lo
// confirma/corrige la usuaria en el momento, como payments.fee_amount.
export const feeSuggestionSchema = z.object({
  payment_method_id: z.string().trim().uuid("Elegí un método de pago."),
  // Vacío = sugerencia genérica para el método, sin importar la cuenta.
  account_id: optionalUuid(),
  suggested_percentage: z
    .number()
    .min(0, "Tiene que ser 0 o más.")
    .max(100, "No puede ser mayor a 100."),
});

export type FeeSuggestionInput = z.infer<typeof feeSuggestionSchema>;
