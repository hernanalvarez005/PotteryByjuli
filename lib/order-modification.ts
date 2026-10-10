// "Modificar pedido": reglas y vista previa. Puro (sin Supabase ni React).
//
// La REGLA real vive en Postgres (`modify_order`, supabase/migrations/
// 20261010090000_modify_order.sql), que la re-verifica con el pedido bloqueado.
// Esto sólo la espeja para no ofrecer en la pantalla acciones que el servidor
// va a rechazar, y calcula la vista previa de totales/saldo.

export type ModifiableStatus = "pending" | "confirmed" | "in_production" | "ready" | "delivered" | "cancelled";

/** ¿Se puede abrir "Modificar pedido"? Sólo pedidos (no ventas rápidas) no cancelados. */
export function canModifyOrder(input: { status: string; operationType: string }): boolean {
  return input.operationType === "order" && input.status !== "cancelled";
}

export type ItemRules = {
  /** Agregar ítems / subir cantidad: siempre en un pedido activo. */
  canIncrease: true;
  canDecrease: boolean;
  canRemove: boolean;
  /** Por qué no se puede reducir/quitar (para mostrarlo en pantalla). */
  blockedReason: string | null;
};

/**
 * - pending: todo.
 * - confirmed / in_production / ready: reducir/quitar sólo ítems PERSONALIZADOS
 *   (los de catálogo tienen stock reservado o producción asociada).
 * - delivered: nunca reducir ni quitar (es historia); sólo agregar.
 */
export function itemRules(status: string, isCustom: boolean): ItemRules {
  if (status === "delivered") {
    return { canIncrease: true, canDecrease: false, canRemove: false, blockedReason: "El pedido ya fue entregado: sólo se pueden agregar ítems." };
  }
  if (status === "pending" || isCustom) {
    return { canIncrease: true, canDecrease: true, canRemove: true, blockedReason: null };
  }
  return {
    canIncrease: true,
    canDecrease: false,
    canRemove: false,
    blockedReason: "Reducir o quitar ítems de catálogo sólo se permite mientras el pedido está pendiente (tienen stock reservado o producción).",
  };
}

export const DELIVERED_WARNING = "Este pedido ya fue entregado. Estás agregando un ítem posterior a la entrega.";

/** Un cambio tal como lo recibe `modify_order`. */
export type ModifyChange =
  | { op: "add"; product_variant_id: string; quantity: number; unit_price: number }
  | { op: "add"; custom_name: string; custom_description?: string; quantity: number; unit_price: number }
  | { op: "set_quantity"; order_item_id: string; quantity: number }
  | { op: "remove"; order_item_id: string };

export type CurrentItem = { id: string; quantity: number; unit_price: number; isCustom: boolean };
export type AddedItem = { quantity: number; unit_price: number };

export type DraftState = {
  /** quantity nueva por order_item_id (sólo los que cambiaron). */
  quantities: Record<string, number>;
  removed: ReadonlySet<string>;
  added: AddedItem[];
};

/** Subtotal resultante tras aplicar el borrador. */
export function previewSubtotal(items: CurrentItem[], draft: DraftState): number {
  const existing = items
    .filter((i) => !draft.removed.has(i.id))
    .reduce((sum, i) => sum + (draft.quantities[i.id] ?? i.quantity) * i.unit_price, 0);
  const added = draft.added.reduce((sum, a) => sum + a.quantity * a.unit_price, 0);
  return existing + added;
}

export type Preview = {
  subtotal: number;
  total: number;
  /** Saldo = nuevo total − pagos reales (nunca negativo, igual que order_balances). */
  balance: number;
  /** Diferencia del total respecto del actual. */
  totalDelta: number;
};

export function previewTotals(input: { items: CurrentItem[]; draft: DraftState; discountTotal: number; currentTotal: number; paid: number }): Preview {
  const subtotal = previewSubtotal(input.items, input.draft);
  const total = subtotal - input.discountTotal;
  return { subtotal, total, balance: Math.max(total - input.paid, 0), totalDelta: total - input.currentTotal };
}

/** Convierte el borrador en la lista de cambios para `modify_order`, sin no-ops. */
export function buildChanges(items: CurrentItem[], draft: DraftState, added: ModifyChange[]): ModifyChange[] {
  const changes: ModifyChange[] = [];
  for (const item of items) {
    if (draft.removed.has(item.id)) {
      changes.push({ op: "remove", order_item_id: item.id });
      continue;
    }
    const next = draft.quantities[item.id];
    if (next != null && next !== item.quantity) changes.push({ op: "set_quantity", order_item_id: item.id, quantity: next });
  }
  return [...changes, ...added];
}

/** ¿El borrador agrega algún ítem de catálogo? (para mostrar "Descontar del stock"). */
export function addsCatalogItems(added: ModifyChange[]): boolean {
  return added.some((c) => c.op === "add" && "product_variant_id" in c);
}

/** ¿Algún cambio sube la cantidad de un ítem de catálogo? También mueve stock. */
export function increasesCatalogQuantity(items: (CurrentItem & { variantId?: string | null })[], draft: DraftState): boolean {
  return items.some((i) => !i.isCustom && !draft.removed.has(i.id) && (draft.quantities[i.id] ?? i.quantity) > i.quantity);
}

export type PdfStaleness = "none" | "stale";

/**
 * "PDF desactualizado": existe una modificación POSTERIOR a la generación del
 * PDF. Derivado (no se guarda): el PDF viejo representa el estado anterior.
 */
export function pdfStaleness(input: { pdfGeneratedAt: string | null; lastAdjustmentAt: string | null }): PdfStaleness {
  if (!input.pdfGeneratedAt || !input.lastAdjustmentAt) return "none";
  return new Date(input.lastAdjustmentAt).getTime() > new Date(input.pdfGeneratedAt).getTime() ? "stale" : "none";
}

export const STOCK_EFFECT_LABELS: Record<string, string> = {
  none: "",
  reserved: "Stock reservado",
  consumed: "Stock descontado",
  not_consumed: "Sin movimiento de stock",
};
