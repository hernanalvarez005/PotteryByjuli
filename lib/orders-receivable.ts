// Presentación del KPI "Pendiente de cobrar" de /pedidos y filtro por unidad
// de negocio. Puro (sin Supabase ni React) para poder probarlo aislado.
import type { OrdersReceivable } from "@/lib/orders";

export type BusinessUnitFilterOption = { id: string; code: string; name: string };

/**
 * El filtro viaja en la URL por CÓDIGO semántico (`?unit=wholesale`), nunca
 * por id. Un código desconocido (o vacío) equivale a "todas las unidades":
 * nunca rompe la pantalla ni filtra por algo inexistente.
 */
export function resolveBusinessUnitFilter(
  code: string | null | undefined,
  units: BusinessUnitFilterOption[]
): BusinessUnitFilterOption | null {
  if (!code) return null;
  return units.find((u) => u.code === code) ?? null;
}

type FormatMoney = (amount: number) => string;

/**
 * Aclaraciones bajo el KPI para que el total no parezca inconsistente con las
 * filas visibles. El KPI SIEMPRE cuenta archivados y sin confirmar (decisión
 * de negocio); lo que cambia es qué muestra cada vista:
 * - sin "ver archivados" → los archivados con deuda no se ven en la vista;
 * - Kanban → nunca muestra pedidos `pending` (viven en la Lista).
 */
export function receivableNotes(input: {
  data: OrdersReceivable;
  view: "list" | "kanban";
  showArchived: boolean;
  formatMoney: FormatMoney;
}): string[] {
  const { data, view, showArchived, formatMoney } = input;
  const notes: string[] = [];
  if (!showArchived && data.archivedOrdersCount > 0) {
    notes.push(
      `Incluye ${formatMoney(data.archivedPendingTotal)} de ${plural(data.archivedOrdersCount, "pedido archivado", "pedidos archivados")} que esta vista no muestra.`
    );
  }
  if (view === "kanban" && data.unconfirmedOrdersCount > 0) {
    notes.push(
      `Incluye ${formatMoney(data.unconfirmedPendingTotal)} de ${plural(data.unconfirmedOrdersCount, "pedido sin confirmar", "pedidos sin confirmar")} (se ven en la Lista, no en el Kanban).`
    );
  }
  return notes;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
