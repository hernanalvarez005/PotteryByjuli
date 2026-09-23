import { createClient } from "@/lib/supabase/server";

export type OrderListRow = {
  id: string;
  human_code: string;
  status: string;
  total: number;
  created_at: string;
  estimated_date: string | null;
  archived_at: string | null;
  customers: { first_name: string; last_name: string | null } | null;
  business_units: { name: string } | null;
};

/**
 * `operationType` filtra por `orders.operation_type` — 'order' para el
 * listado operativo de Pedidos (encargos/personalizados), 'retail_sale'
 * para el listado de Ventas recientes. Nunca mezclar ambos en la misma
 * pantalla: son dos vistas de un mismo modelo de datos, no dos tablas,
 * pero conceptualmente son operaciones distintas (ver auditoría "Próxima
 * evolución operativa de Pottery", Bloque 2).
 *
 * `includeArchived` (default false) — un pedido archivado (Bloque 4,
 * Kanban) sigue existiendo igual que cualquier otro, sólo se saca del
 * trabajo activo por default. `false` filtra `archived_at is null`;
 * `true` trae todo, para el switch "Ver archivados".
 */
export async function getOrders(options?: {
  operationType?: "order" | "retail_sale";
  includeArchived?: boolean;
}): Promise<{ orders: OrderListRow[]; paidByOrder: Record<string, number> }> {
  const supabase = await createClient();

  let query = supabase
    .from("orders")
    .select(
      "id,human_code,status,total,created_at,estimated_date,archived_at,customers(first_name,last_name),business_units(name)"
    )
    .order("created_at", { ascending: false });
  if (options?.operationType) {
    query = query.eq("operation_type", options.operationType);
  }
  if (!options?.includeArchived) {
    query = query.is("archived_at", null);
  }

  // Sólo los pagos de pedidos que esta consulta realmente muestra — antes
  // traía `payments` entera sin ningún filtro (perf audit, P0.2 —
  // 2026-09-23): cada cuota de taller, cada venta minorista, cada pago de
  // cualquier unidad de negocio, sin relación con lo que esta pantalla
  // pinta. Se filtra con el MISMO criterio que `query` de arriba, pero vía
  // un embed (`orders!inner(...)`) — nunca `.in("order_id", orderIds)`:
  // con miles de pedidos esa lista de ids satura la URL (probado: HTTP 414
  // a partir de ~1.500 ids). El embed filtra en el servidor sin mandar
  // ningún id por la red, y de paso permite volver a correr ambas
  // consultas en paralelo (ninguna depende del resultado de la otra).
  let paymentsQuery = supabase
    .from("payments")
    .select("order_id,amount,orders!inner(operation_type,archived_at)")
    .not("order_id", "is", null);
  if (options?.operationType) {
    paymentsQuery = paymentsQuery.eq("orders.operation_type", options.operationType);
  }
  if (!options?.includeArchived) {
    paymentsQuery = paymentsQuery.is("orders.archived_at", null);
  }

  const [{ data: orders }, { data: payments }] = await Promise.all([query, paymentsQuery]);

  const paidByOrder: Record<string, number> = {};
  for (const p of (payments ?? []) as { order_id: string; amount: number }[]) {
    paidByOrder[p.order_id] = (paidByOrder[p.order_id] ?? 0) + p.amount;
  }

  return { orders: (orders ?? []) as unknown as OrderListRow[], paidByOrder };
}
