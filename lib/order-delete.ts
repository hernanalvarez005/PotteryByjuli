// Presentación de la eliminación de un pedido (puro, sin React ni Supabase).
//
// La REGLA no vive acá: la decide `classify_order_for_delete` en Postgres y `delete_order_safe` la
// vuelve a exigir (motivo, confirmación y código tipeado se validan en la base). Esto sólo traduce
// la clasificación a texto y dice si el botón de confirmar puede habilitarse, para no ofrecer lo que
// el servidor va a rechazar.

export type DeleteLevel = "simple" | "untouched_production" | "test_checkout" | "quick_sale";

/** Fila de `classify_order_for_delete` (sólo los campos que usa la UI). */
export type DeleteInfoRow = {
  level: DeleteLevel | null;
  requires_confirmation: boolean;
  requires_reason: boolean;
  payments_count: number;
  payments_total: number | string;
  production_orders_count: number;
  stock_units_to_return: number;
};

export type DeleteInfo = {
  level: DeleteLevel | null;
  requiresConfirmation: boolean;
  requiresReason: boolean;
  paymentsCount: number;
  paymentsTotal: number;
  productionOrdersCount: number;
  stockUnitsToReturn: number;
};

export type DeleteDraft = { reason: string; confirmed: boolean; confirmCode: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Qué se va a perder, en una lista (vacía para la eliminación simple). */
export function deleteConsequences(info: DeleteInfo, formatMoney: (n: number) => string): string[] {
  const out: string[] = [];
  if (info.level === "quick_sale") {
    if (info.paymentsCount > 0) {
      out.push(
        `Se eliminan ${plural(info.paymentsCount, "pago", "pagos")} por ${formatMoney(info.paymentsTotal)} (quedan registrados en la auditoría).`
      );
    }
    if (info.stockUnitsToReturn > 0) {
      out.push(
        `Se devuelve al stock ${plural(info.stockUnitsToReturn, "unidad", "unidades")} con un movimiento de devolución; la venta original queda en el historial de stock.`
      );
    }
    out.push("La venta deja de contar en ventas, dashboard y reportes.");
  }
  if (info.productionOrdersCount > 0 && (info.level === "untouched_production" || info.level === "test_checkout")) {
    out.push(
      `Se elimina ${plural(info.productionOrdersCount, "orden de producción sin tocar", "órdenes de producción sin tocar")} asociada al pedido.`
    );
  }
  return out;
}

export function deleteConfirmationLabel(level: DeleteLevel | null): string {
  return level === "quick_sale"
    ? "Entiendo que se devuelve el stock y se eliminan los pagos de esta venta"
    : "Era una prueba / un error";
}

/** ¿Puede habilitarse "Eliminar"? Refleja lo que `delete_order_safe` va a exigir. */
export function canConfirmDelete(info: DeleteInfo, draft: DeleteDraft, humanCode: string): boolean {
  if (info.requiresReason && draft.reason.trim() === "") return false;
  if (info.requiresConfirmation) {
    if (!draft.confirmed) return false;
    if (draft.confirmCode.trim().toUpperCase() !== humanCode.toUpperCase()) return false;
  }
  return true;
}
