import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { computeDueDisplayStatus } from "@/lib/workshop-dues";
import { customerDisplayName } from "@/lib/customers-shared";
import {
  dateOnlyToArgentinaStartOfDayISO,
  dateOnlyToArgentinaEndOfDayISO,
  todayInArgentina,
} from "@/lib/format";

/** La unidad "classes" (Talleres) la resuelven tanto getDashboardSummary
 * como getSalesByBusinessUnit — ambas se llaman dentro del mismo
 * Promise.all en dashboard/page.tsx, así que sin esto es la misma query
 * ejecutada 2 veces por navegación (perf audit H-03). cache() memoiza
 * por request/render, nunca entre navegaciones distintas — no es un
 * caché persistente de datos dinámicos, sólo evita repetir el mismo
 * lookup dentro de la misma carga de página. */
const getClassesUnit = cache(async (): Promise<{ id: string; name: string } | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("business_units").select("id,name").eq("code", "classes").maybeSingle();
  return data;
});

/** Mismo shape que DuePaymentRow (talleres/[groupId]/dues-panel.tsx) —
 * "Necesita atención" reusa RegisterPaymentDialog tal cual, así que
 * necesita exactamente los mismos campos por pago. */
export type PendingDuePayment = {
  id: string;
  amount: number;
  paid_at: string;
  method_id: string | null;
  account_id: string | null;
  reference: string | null;
  notes: string | null;
  fee_amount: number;
};

export type PendingDueRow = {
  id: string;
  groupId: string;
  groupName: string;
  customerName: string;
  period: string;
  totalDue: number;
  paidTotal: number;
  balance: number;
  payments: PendingDuePayment[];
};

/** Cuántas cuotas pendientes trae el detalle de "Necesita atención"
 * (perf audit P1) — las más antiguas primero, nunca todas: el conteo
 * real (nunca topeado) viaja aparte en `pendingDuesCount`. */
export const PENDING_DUES_DETAIL_LIMIT = 50;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Filtros genuinamente server-side del dashboard (sección 8 de la tanda
 * de mejoras operativas) — a diferencia de /clientes?segment= o
 * /stock?location=, que traen todo y filtran en JS a pesar de parecer
 * server-side, estos empujan de verdad `.gte()/.lte()/.eq()` a la query.
 * `from`/`to` son fechas AAAA-MM-DD (rango inclusive, en hora
 * Argentina); los tres ids, cuando vienen, son `null` = "Todas".
 */
export type DashboardFilters = {
  from: string;
  to: string;
  /** null = "Todas" (sección 33: nunca una lista hardcodeada de ids que
   * pueda quedar vieja si se agrega una unidad de negocio nueva) — un
   * array de 1+ ids es un multi-select real (sección 31-32), nunca
   * "traer todo y filtrar en React". */
  businessUnitIds: string[] | null;
  locationId: string | null;
  channelId: string | null;
};

export function defaultDashboardFilters(): DashboardFilters {
  const now = new Date();
  const monthStart = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
  })
    .format(now)
    .concat("-01");
  return { from: monthStart, to: todayInArgentina(), businessUnitIds: null, locationId: null, channelId: null };
}

/**
 * "Todo el histórico, no sólo el mes actual" (/reportes) — un rango
 * deliberadamente amplio, no un caso especial de "sin fecha" en cada
 * función: las mismas funciones filtradas por fecha que usa el
 * dashboard sirven para el histórico completo con este único filtro.
 */
export function allTimeDashboardFilters(): DashboardFilters {
  return { from: "2000-01-01", to: todayInArgentina(), businessUnitIds: null, locationId: null, channelId: null };
}

function dateRange(filters: Pick<DashboardFilters, "from" | "to">) {
  return {
    fromIso: dateOnlyToArgentinaStartOfDayISO(filters.from),
    toIso: dateOnlyToArgentinaEndOfDayISO(filters.to),
  };
}

/**
 * business_unit_id/location_id/closing_channel_id — los tres `.eq()`
 * opcionales que casi toda función de este archivo aplica sobre
 * `orders`. No hay un helper genérico que los encadene (un intento
 * anterior con un tipo genérico sobre el query builder de Supabase
 * disparaba "Type instantiation is excessively deep" en TS) — cada
 * función los aplica con el mismo `if` de tres líneas de abajo, así que
 * quedan desincronizados fácil de notar en un diff si alguna vez uno
 * cambia sin el otro.
 */

/** Alcance común de todos los RPC de reportes (`report_*`): rango de fechas + filtros. */
function scopeArgs(filters: DashboardFilters) {
  return {
    p_from: filters.from,
    p_to: filters.to,
    p_business_unit_ids: filters.businessUnitIds,
    p_location_id: filters.locationId,
    p_channel_id: filters.channelId,
  };
}

/** Llama a un RPC de reportes. Un error NUNCA se traga: un reporte que falla no puede mostrar ceros. */
async function reportRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`Reporte ${name}: ${error.message}`);
  return (data ?? []) as T[];
}

const num = (v: unknown) => Number(v ?? 0);

/**
 * KPIs oficiales (docs/business-rules.md § Reportes) — un solo cálculo en Postgres (`report_kpis`):
 *  - facturación: pedidos NO cancelados por sale_date; ticket promedio = facturación ÷ pedidos;
 *  - cobrado: caja por paid_at (pedidos + talleres + otros ingresos, con las reglas de inclusión);
 *  - pendiente: saldo vigente de la cohorte facturada (`cohortPending`) y de TODOS los pedidos
 *    (`pendingTotalAll`, el mismo número que el KPI de /pedidos);
 *  - Talleres (`collectedWorkshops`) se informa aparte, nunca como facturación.
 */
export type ReportKpis = {
  invoiced: number;
  ordersCount: number;
  avgTicket: number | null;
  collectedTotal: number;
  collectedOrders: number;
  collectedWorkshops: number;
  collectedOther: number;
  /** Plata cobrada sobre pedidos cancelados (informativo: no entra en "cobrado"). */
  collectedOnCancelled: number;
  cohortPaid: number;
  cohortPending: number;
  cohortOverpaid: number;
  pendingTotalAll: number;
  pendingOrdersAll: number;
};

export async function getReportKpis(filters: DashboardFilters = defaultDashboardFilters()): Promise<ReportKpis> {
  const [r] = await reportRpc<Record<string, unknown>>("report_kpis", scopeArgs(filters));
  return {
    invoiced: num(r?.invoiced),
    ordersCount: num(r?.orders_count),
    avgTicket: r?.avg_ticket == null ? null : num(r.avg_ticket),
    collectedTotal: num(r?.collected_total),
    collectedOrders: num(r?.collected_orders),
    collectedWorkshops: num(r?.collected_workshops),
    collectedOther: num(r?.collected_other),
    collectedOnCancelled: num(r?.collected_on_cancelled),
    cohortPaid: num(r?.cohort_paid),
    cohortPending: num(r?.cohort_pending),
    cohortOverpaid: num(r?.cohort_overpaid),
    pendingTotalAll: num(r?.pending_total_all),
    pendingOrdersAll: num(r?.pending_orders_all),
  };
}

/** Everything the "Hoy" dashboard needs, in one pass. */
export async function getDashboardSummary(filters: DashboardFilters = defaultDashboardFilters()) {
  const supabase = await createClient();
  const today = todayIso();
  // Facturación, cobrado y pendiente salen de `report_kpis` (UNA definición, agregada en Postgres —
  // nunca filas sumadas en JS, que PostgREST corta en 1.000). Ver docs/business-rules.md § Reportes.
  const kpisPromise = getReportKpis(filters);

  // "Necesita atención → Cuotas pendientes" (perf audit, P1 —
  // 2026-09-24): antes traía TODAS las cuotas de talleres de la
  // historia, sin ningún filtro, para recién decidir pendiente/parcial
  // en JS — sin `order by`, PostgREST ya corta eso en su límite de
  // página por default (1.000 filas) en un orden no garantizado, así
  // que en cualquier negocio con suficiente historial "Necesita
  // atención" podía estar mostrando un recorte arbitrario, no
  // necesariamente la deuda real. `workshop_due_balances` (vista, misma
  // fórmula que computeDueSummary/computeDueBalance, nunca una segunda
  // lógica) filtra `balance > 0` en el servidor — el conteo real sale
  // de un `count: "exact"` aparte (nunca topeado), y el detalle mostrado
  // se limita a las 50 cuotas pendientes más antiguas primero (deuda
  // vieja tiene prioridad) — nunca por `balance` descendente, decisión
  // explícita: la antigüedad de la deuda importa más que el monto.
  const pendingDuesCountQuery = supabase
    .from("workshop_due_balances")
    .select("due_id", { count: "exact", head: true })
    .neq("status", "cancelled")
    .gt("balance", 0);
  const pendingDueBalancesQuery = supabase
    .from("workshop_due_balances")
    .select("due_id,enrollment_id,period,status,total_due,paid_total,balance,base_waived")
    .neq("status", "cancelled")
    .gt("balance", 0)
    .order("period", { ascending: true })
    .limit(PENDING_DUES_DETAIL_LIMIT);

  const [
    kpis,
    { count: activeOrdersCount },
    { count: overdueOrdersCount },
    { count: pendingProductionCount },
    { count: newWholesaleCount },
    { count: pendingDuesCountRaw },
    { data: pendingDueBalances },
    { data: upcomingEvents },
    classesUnit,
  ] = await Promise.all([
    kpisPromise,
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(delivered,cancelled)"),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(delivered,cancelled)")
      .lt("estimated_date", today)
      .not("estimated_date", "is", null),
    supabase
      .from("production_orders")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(done,cancelled)"),
    supabase
      .from("orders")
      .select("id,business_units!inner(code)", { count: "exact", head: true })
      .eq("business_units.code", "wholesale")
      .eq("status", "pending"),
    pendingDuesCountQuery,
    pendingDueBalancesQuery,
    supabase
      .from("events")
      .select("id,human_code,name,event_date,event_type")
      .gte("event_date", today)
      .neq("status", "cancelled")
      .order("event_date")
      .limit(5),
    getClassesUnit(),
  ]);

  const classesUnitId = classesUnit?.id ?? null;
  // Las cuotas de talleres no tienen business_unit_id propio — sólo
  // corresponde incluirlas cuando el filtro es "Todas" o específicamente
  // "classes" (decisión de arquitectura de esta tanda).
  const includeDuesInFilter =
    filters.businessUnitIds == null || (classesUnitId != null && filters.businessUnitIds.includes(classesUnitId));
  // Tampoco tienen canal — un filtro de canal activo las excluye siempre
  // (se avisa explícitamente en la UI, nunca parece un bug silencioso).
  const includeDuePayments = includeDuesInFilter && filters.channelId == null;
  // Otros ingresos (Bloque 6) no pertenecen a ninguna unidad de negocio
  // del catálogo ni tienen canal — a diferencia de Talleres (que sí
  // corresponde a la unidad "classes"), no hay ninguna unidad específica
  // bajo la que deban aparecer. Sólo se suman a "Cobrado" cuando la vista
  // es genuinamente "Todas las unidades, sin canal" — nunca atribuidos a
  // una unidad o canal que no tienen.
  const includeIncomeEntries = filters.businessUnitIds == null && filters.channelId == null;

  // Enrichment de las (a lo sumo 50) cuotas mostradas — nunca de las
  // potencialmente miles que matchean el filtro real, sólo de las que
  // efectivamente se van a pintar — y el total de pagos de cuotas del
  // período (antes en un await separado, sin relación de datos con el
  // enrichment: ninguno de los dos depende del resultado del otro, así
  // que corren en el mismo Promise.all en vez de uno detrás del otro
  // (perf audit H-03). Ambos corren DESPUÉS del Promise.all principal
  // porque el enrichment necesita los ids que ese batch acaba de
  // resolver.
  const shownDueIds = (pendingDueBalances ?? []).map((d) => d.due_id as string);
  const shownEnrollmentIds = [...new Set((pendingDueBalances ?? []).map((d) => d.enrollment_id as string))];
  const [{ data: shownDuePayments }, { data: shownEnrollments }] = await Promise.all([
    shownDueIds.length
      ? supabase
          .from("payments")
          .select("id,amount,paid_at,method_id,account_id,reference,notes,fee_amount,workshop_due_id")
          .in("workshop_due_id", shownDueIds)
      : Promise.resolve({ data: [] as never[] }),
    shownDueIds.length
      ? supabase
          .from("workshop_enrollments")
          .select("id,group_id,customers(first_name,last_name),workshop_groups(name)")
          .in("id", shownEnrollmentIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  // workshop_due_balances (vista, perf audit P1) ya filtró server-side
  // `status<>'cancelled' AND balance>0` — por construcción, toda fila que
  // llega acá computa a display-status 'pending' o 'partial', nunca
  // 'paid'/'cancelled'. Igual se pasa por computeDueDisplayStatus (nunca
  // se infiere el estado "porque el SQL ya filtró") — sigue siendo la
  // única función que decide pendiente/parcial/pagada/cancelada, ahora
  // alimentada por los agregados de la vista en vez de arrays crudos de
  // payments/items. pendingDuesCount es el conteo real (exact, nunca
  // topeado por el límite de página de PostgREST); pendingDuesDetail son
  // sólo las `PENDING_DUES_DETAIL_LIMIT` más antiguas — "Necesita
  // atención" ya no puede mostrar más pedidos de los que realmente
  // trajo, ambos números viajan por separado para que la UI lo diga.
  const shownDuePaymentsByDue = new Map<string, PendingDuePayment[]>();
  for (const p of (shownDuePayments ?? []) as (PendingDuePayment & { workshop_due_id: string })[]) {
    const list = shownDuePaymentsByDue.get(p.workshop_due_id) ?? [];
    list.push({
      id: p.id,
      amount: p.amount,
      paid_at: p.paid_at,
      method_id: p.method_id,
      account_id: p.account_id,
      reference: p.reference,
      notes: p.notes,
      fee_amount: p.fee_amount,
    });
    shownDuePaymentsByDue.set(p.workshop_due_id, list);
  }
  const shownEnrollmentById = new Map(
    ((shownEnrollments ?? []) as unknown as {
      id: string;
      group_id: string;
      customers: { first_name: string; last_name: string | null } | null;
      workshop_groups: { name: string } | null;
    }[]).map((e) => [e.id, e])
  );

  const pendingDuesCount = pendingDuesCountRaw ?? 0;
  const pendingDuesDetail: PendingDueRow[] = (pendingDueBalances ?? [])
    .filter((d) => {
      // Defensivo, nunca debería excluir nada (la vista ya garantiza
      // balance>0 y status<>cancelled) — pero el estado nunca se infiere
      // sin pasar por la función canónica, así que se vuelve a chequear acá.
      const displayStatus = computeDueDisplayStatus(
        d.status as "pending" | "cancelled",
        d.total_due as number,
        d.paid_total as number,
        d.base_waived as boolean
      );
      return displayStatus === "pending" || displayStatus === "partial";
    })
    .map((d) => {
      const enrollment = shownEnrollmentById.get(d.enrollment_id as string);
      return {
        id: d.due_id as string,
        groupId: enrollment?.group_id ?? "",
        groupName: enrollment?.workshop_groups?.name ?? "—",
        customerName: enrollment?.customers ? customerDisplayName(enrollment.customers) : "—",
        period: d.period as string,
        totalDue: d.total_due as number,
        paidTotal: d.paid_total as number,
        balance: d.balance as number,
        payments: shownDuePaymentsByDue.get(d.due_id as string) ?? [],
      };
    });

  return {
    kpis,
    // Alias de los nombres históricos (el dashboard los lee así).
    totalInvoicedFiltered: kpis.invoiced,
    collectedFiltered: kpis.collectedTotal,
    // Pendiente = saldo vigente (order_balances) de lo facturado en el período — ver § Reportes.
    pendingToCollect: kpis.cohortPending,
    duesExcludedByChannelFilter: includeDuesInFilter && !includeDuePayments,
    // A diferencia de las cuotas (que sí tienen una unidad propia,
    // "classes"), Otros ingresos no pertenece a ninguna unidad — CUALQUIER
    // filtro de unidad específica lo excluye, no sólo uno que no sea la suya.
    incomeEntriesExcludedByFilter: !includeIncomeEntries,
    activeOrdersCount: activeOrdersCount ?? 0,
    overdueOrdersCount: overdueOrdersCount ?? 0,
    pendingProductionCount: pendingProductionCount ?? 0,
    newWholesaleCount: newWholesaleCount ?? 0,
    pendingDuesCount,
    pendingDuesDetail,
    upcomingEvents: upcomingEvents ?? [],
  };
}

export type IncomeEntriesSummary = {
  total: number;
  count: number;
  byCategory: { category: string; total: number }[];
};

/**
 * Otros ingresos (Bloque 6) para /reportes — "aparece en reportes
 * financieros" del criterio de done. Consulta exclusivamente
 * `income_entries`: nunca se une a `order_items`/`products`, así que por
 * construcción no puede aparecer en "productos más vendidos" ni afectar
 * ningún reporte de stock.
 */
export async function getIncomeEntriesSummary(
  filters: DashboardFilters = defaultDashboardFilters()
): Promise<IncomeEntriesSummary> {
  const supabase = await createClient();
  const { fromIso, toIso } = dateRange(filters);
  let query = supabase
    .from("income_entries")
    .select("amount,category")
    .gte("occurred_at", fromIso)
    .lte("occurred_at", toIso);
  if (filters.locationId) query = query.eq("location_id", filters.locationId);
  const { data } = await query;

  const rows = data ?? [];
  const byCategory = new Map<string, number>();
  for (const row of rows) {
    const category = row.category ?? "Sin categoría";
    byCategory.set(category, (byCategory.get(category) ?? 0) + row.amount);
  }

  return {
    total: rows.reduce((sum, r) => sum + r.amount, 0),
    count: rows.length,
    byCategory: [...byCategory.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total),
  };
}

export type TopProductRow = { label: string; unitsSold: number; revenue: number; isCustom: boolean };

/**
 * Productos más vendidos: unidades y facturación por ítem (cantidad × precio, ANTES del descuento
 * global del pedido), de pedidos no cancelados por sale_date. Los ítems a medida (sin variante)
 * van agrupados en "Ítems a medida" — no se descartan, para que la suma cierre con la facturación.
 */
export async function getTopProducts(filters: DashboardFilters = defaultDashboardFilters(), limit = 10): Promise<TopProductRow[]> {
  const rows = await reportRpc<{ label: string; units: string; revenue: string; is_custom: boolean }>("report_top_products", {
    ...scopeArgs(filters),
    p_limit: limit,
  });
  return rows.map((r) => ({ label: r.label, unitsSold: num(r.units), revenue: num(r.revenue), isCustom: r.is_custom }));
}

/** Una variante elegida en una selección libre, con lo vendido en el período (0 si no vendió). */
export type SelectionRow = {
  variantId: string;
  productId: string;
  label: string;
  unitsSold: number;
  revenue: number;
};

/**
 * "¿Cuántas unidades vendí de estos modelos?": agrupa a mano varios productos (con todas sus
 * variantes) y/o variantes sueltas y devuelve una fila por variante (también las que no vendieron)
 * más el total del grupo. Mismo alcance y filtros que la facturación. Selección vacía → vacío.
 */
export async function getUnitsSoldForSelection(
  filters: DashboardFilters,
  selection: { productIds?: string[]; variantIds?: string[] }
): Promise<{ rows: SelectionRow[]; totalUnits: number; totalRevenue: number }> {
  const productIds = selection.productIds ?? [];
  const variantIds = selection.variantIds ?? [];
  if (productIds.length === 0 && variantIds.length === 0) return { rows: [], totalUnits: 0, totalRevenue: 0 };
  const data = await reportRpc<{ variant_id: string; product_id: string; label: string; units: string; revenue: string }>(
    "report_units_sold_selection",
    { ...scopeArgs(filters), p_product_ids: productIds, p_variant_ids: variantIds }
  );
  const rows = data.map((r) => ({
    variantId: r.variant_id,
    productId: r.product_id,
    label: r.label,
    unitsSold: num(r.units),
    revenue: num(r.revenue),
  }));
  return {
    rows,
    totalUnits: rows.reduce((sum, r) => sum + r.unitsSold, 0),
    totalRevenue: rows.reduce((sum, r) => sum + r.revenue, 0),
  };
}

/**
 * Facturación por unidad de negocio — SÓLO pedidos (devengado). Talleres NO se mezcla acá: las
 * cuotas cobradas son caja y se informan aparte (`ReportKpis.collectedWorkshops`).
 */
export async function getSalesByBusinessUnit(filters: DashboardFilters = defaultDashboardFilters()) {
  const rows = await reportRpc<{ name: string; invoiced: string }>("report_by_business_unit", scopeArgs(filters));
  return rows.map((r) => ({ name: r.name, total: num(r.invoiced) }));
}

/**
 * Facturación por canal de cierre ("Sin canal" para los pedidos sin canal). Nunca incorpora
 * Talleres ni Otros ingresos: no tienen un canal real.
 */
export async function getMixByChannel(filters: DashboardFilters = defaultDashboardFilters()) {
  const rows = await reportRpc<{ name: string; invoiced: string }>("report_by_channel", scopeArgs(filters));
  return rows.map((r) => ({ name: r.name, total: num(r.invoiced) }));
}

export type SalesOverTimePoint = { bucket: string; total: number; ordersCount: number; collected: number };

/**
 * Facturación en el tiempo — diaria si el rango es ≤ 62 días, mensual si es más largo; los buckets
 * sin datos vienen en 0. Cuenta lo MISMO que el KPI de facturación (todos los pedidos no
 * cancelados por sale_date, no sólo los entregados), así la suma de la serie == el KPI.
 * `collected` es la caja del mismo bucket (por paid_at): Σ collected == KPI de cobrado.
 */
export async function getSalesOverTime(filters: DashboardFilters = defaultDashboardFilters()): Promise<SalesOverTimePoint[]> {
  const rows = await reportRpc<{ bucket: string; invoiced: string; orders_count: string; collected: string }>(
    "report_time_series",
    scopeArgs(filters)
  );
  return rows.map((r) => ({ bucket: r.bucket, total: num(r.invoiced), ordersCount: num(r.orders_count), collected: num(r.collected) }));
}

export async function getWholesaleConversion() {
  const [row] = await reportRpc<{ total: string; confirmed: string }>("report_wholesale_conversion");
  const total = num(row?.total);
  const confirmed = num(row?.confirmed);
  return { total, confirmed, conversionRate: total > 0 ? confirmed / total : 0 };
}

export async function getProductionCounts() {
  const rows = await reportRpc<{ status: string; orders_count: string }>("report_production_counts");
  return new Map(rows.map((r) => [r.status, num(r.orders_count)]));
}
