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

/** `created_at` + `id` (nunca sólo `created_at`) — con datos cargados en
 * lote (tests, importaciones) es común que muchas filas compartan el
 * mismo timestamp exacto; un cursor de un solo campo saltearía o
 * repetiría filas ahí. Confirmado con datos reales del dataset local
 * (perf audit H-08 bloque 2). */
export type OrdersPageCursor = { createdAt: string; id: string } | null;

export const ORDERS_PAGE_SIZE = 25;

/**
 * Versión paginada de getOrders() para la vista Lista de /pedidos y
 * /ventas (perf audit H-08 bloque 2) — el Kanban de /pedidos sigue
 * usando getOrders() sin paginar, sin tocar (fuera de alcance de este
 * bloque).
 *
 * Dos correcciones de fondo, no sólo de performance, respecto al
 * getOrders() de arriba:
 *
 * 1. `orders` ya no depende del límite de página implícito de
 *    PostgREST (1.000 filas) — a 18.000 pedidos reales, esa query
 *    devolvía sólo el 5,5% más reciente, silenciosamente. Acá se pagina
 *    de verdad con keyset: `LIMIT ORDERS_PAGE_SIZE`, nunca "traer todo
 *    y cortar en el cliente".
 *
 * 2. `paidByOrder` ya NUNCA es una query global de `payments` (que
 *    también topeaba en 1.000 de 18.150, sin `order by`, en un orden no
 *    garantizado — un pedido real con pago podía mostrar "Saldo =
 *    Total" como si no tuviera). Acá se piden sólo los pagos de los
 *    ≤ORDERS_PAGE_SIZE pedidos que esta página realmente muestra, vía
 *    `.in("order_id", pageIds)` — un id list de ≤25 nunca corre riesgo
 *    de URL larga (H-02), y el saldo de cada pedido mostrado queda
 *    siempre completo y correcto, sin importar cuántos pedidos/pagos
 *    existan en total.
 *
 * El cursor es keyset, no offset/range — ver la comparación medida en
 * la sesión de diseño H-08/H-12: a profundidad de página, keyset se
 * mantiene ~constante mientras offset crece linealmente con la
 * profundidad (5,7ms vs 1,4ms medido a la fila 10.000 sobre 12.600
 * pedidos). Ningún caso de uso acá necesita "ir a la página 47" — se
 * navega hacia adelante/atrás, que es exactamente lo que keyset resuelve.
 */
export async function getOrdersPage(
  options: {
    operationType?: "order" | "retail_sale";
    includeArchived?: boolean;
  },
  cursor: OrdersPageCursor = null,
  pageSize: number = ORDERS_PAGE_SIZE
): Promise<{ orders: OrderListRow[]; paidByOrder: Record<string, number>; nextCursor: OrdersPageCursor }> {
  const supabase = await createClient();

  // Se pide una fila de más ("peek") para distinguir "esto es
  // exactamente lo último que hay" de "hay más después" — sin esto, con
  // un total exacto en un múltiplo de pageSize, nextCursor quedaría
  // apuntando a una página siguiente que en realidad está vacía
  // (bug real encontrado por el test de esta misma sesión: 30 pedidos
  // fixture, pageSize 10, la página 3 devolvía nextCursor no-nulo).
  let query = supabase
    .from("orders")
    .select(
      "id,human_code,status,total,created_at,estimated_date,archived_at,customers(first_name,last_name),business_units(name)"
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);
  if (options.operationType) {
    query = query.eq("operation_type", options.operationType);
  }
  if (!options.includeArchived) {
    query = query.is("archived_at", null);
  }
  if (cursor) {
    // Equivalente a `(created_at, id) < (cursor.createdAt, cursor.id)` —
    // PostgREST no tiene comparación de tuplas directa, así que se arma
    // como "estrictamente antes en el campo principal" OR "empatado en
    // el principal y estrictamente antes en el desempate".
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    );
  }

  const { data: fetched } = await query;
  const hasNextPage = (fetched?.length ?? 0) > pageSize;
  const orders = hasNextPage ? (fetched ?? []).slice(0, pageSize) : (fetched ?? []);
  const pageIds = orders.map((o) => o.id);

  const { data: payments } = pageIds.length
    ? await supabase.from("payments").select("order_id,amount").in("order_id", pageIds)
    : { data: [] as { order_id: string; amount: number }[] };

  const paidByOrder: Record<string, number> = {};
  for (const p of (payments ?? []) as { order_id: string; amount: number }[]) {
    paidByOrder[p.order_id] = (paidByOrder[p.order_id] ?? 0) + p.amount;
  }

  const lastRow = orders.at(-1) as { created_at: string; id: string } | undefined;
  const nextCursor: OrdersPageCursor =
    lastRow && hasNextPage ? { createdAt: lastRow.created_at, id: lastRow.id } : null;

  return { orders: orders as unknown as OrderListRow[], paidByOrder, nextCursor };
}

/** Las 4 columnas de trabajo activo del Kanban — nunca 'pending' (vive
 * en la Lista, no es trabajo confirmado) ni 'cancelled' (salida
 * terminal, no una etapa). Mismo criterio ya documentado en
 * pedidos-kanban.tsx, repetido acá porque ambos archivos necesitan la
 * lista de estados de forma independiente. */
export const KANBAN_STATUSES = ["confirmed", "in_production", "ready", "delivered"] as const;
export type KanbanStatus = (typeof KANBAN_STATUSES)[number];

/** Tope de tarjetas mostradas por columna — mismo patrón ya usado para
 * "Necesita atención" (perf audit P1, PENDING_DUES_DETAIL_LIMIT): el
 * conteo real de la columna nunca depende de esto, sale de su propio
 * `count: "exact"` aparte. */
export const KANBAN_DETAIL_LIMIT = 50;

/**
 * Datos del Kanban de /pedidos (perf audit H-08 bloque 3) — query
 * propia, separada de getOrdersPage() (Lista): un Kanban no es "página
 * 1 de N", es "todo el trabajo activo, agrupado por estado", así que
 * necesita su propia estrategia, no una reutilización forzada de la
 * paginación de la Lista.
 *
 * Antes: getOrders() sin ningún límite traía TODOS los pedidos activos
 * en una sola query, y cada columna se armaba filtrando ese array en
 * el cliente — a 23.400 pedidos 'confirmed' reales, PostgREST cortaba
 * en 1.000 (4,3%) de forma silenciosa, y el badge de cada columna
 * mostraba `columnOrders.length` sobre ese array ya truncado — un
 * badge "1.000" que en realidad eran 23.400. Ni siquiera hacía falta
 * que las otras columnas tuvieran pedidos para que esto pasara: alcanza
 * con que UNA columna sea lo bastante grande para agotar el límite de
 * página antes de que la query llegue a las demás.
 *
 * Ahora: dos baterías de queries independientes, una por columna
 * (nunca una sola query de "todo el trabajo activo junto"):
 * 1. Conteo exacto (`count: "exact", head: true`) — nunca topeado por
 *    el límite de página de PostgREST, sea cual sea el volumen real.
 * 2. Detalle acotado a KANBAN_DETAIL_LIMIT tarjetas, ordenado igual que
 *    antes (`created_at desc`) — la UX de qué tarjeta aparece primero
 *    no cambia, sólo cuántas se traen como máximo.
 * `paidByOrder` se resuelve sólo para las tarjetas efectivamente
 * mostradas (mismo patrón que getOrdersPage(), bloque 2) — nunca una
 * query global de payments.
 */
export async function getOrdersKanbanBoard(options: {
  includeArchived?: boolean;
}): Promise<{
  ordersByStatus: Record<KanbanStatus, OrderListRow[]>;
  counts: Record<KanbanStatus, number>;
  paidByOrder: Record<string, number>;
}> {
  const supabase = await createClient();
  const includeArchived = options.includeArchived ?? false;

  const [countResults, detailResults] = await Promise.all([
    Promise.all(
      KANBAN_STATUSES.map((status) => {
        let q = supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("operation_type", "order")
          .eq("status", status);
        if (!includeArchived) q = q.is("archived_at", null);
        return q;
      })
    ),
    Promise.all(
      KANBAN_STATUSES.map((status) => {
        let q = supabase
          .from("orders")
          .select(
            "id,human_code,status,total,created_at,estimated_date,archived_at,customers(first_name,last_name),business_units(name)"
          )
          .eq("operation_type", "order")
          .eq("status", status);
        if (!includeArchived) q = q.is("archived_at", null);
        return q.order("created_at", { ascending: false }).limit(KANBAN_DETAIL_LIMIT);
      })
    ),
  ]);

  const counts = Object.fromEntries(
    KANBAN_STATUSES.map((status, i) => [status, countResults[i].count ?? 0])
  ) as Record<KanbanStatus, number>;

  const ordersByStatus = Object.fromEntries(
    KANBAN_STATUSES.map((status, i) => [status, (detailResults[i].data ?? []) as unknown as OrderListRow[]])
  ) as Record<KanbanStatus, OrderListRow[]>;

  const allShownIds = KANBAN_STATUSES.flatMap((status) => ordersByStatus[status].map((o) => o.id));
  const { data: payments } = allShownIds.length
    ? await supabase.from("payments").select("order_id,amount").in("order_id", allShownIds)
    : { data: [] as { order_id: string; amount: number }[] };

  const paidByOrder: Record<string, number> = {};
  for (const p of (payments ?? []) as { order_id: string; amount: number }[]) {
    paidByOrder[p.order_id] = (paidByOrder[p.order_id] ?? 0) + p.amount;
  }

  return { ordersByStatus, counts, paidByOrder };
}
