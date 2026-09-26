import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { computeDueDisplayStatus } from "@/lib/workshop-dues";
import { customerDisplayName } from "@/lib/customers-shared";
import {
  dateOnlyToArgentinaStartOfDayISO,
  dateOnlyToArgentinaEndOfDayISO,
  todayInArgentina,
  APP_TIMEZONE,
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

function startOfMonthIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

/** Primer día del mes actual, fecha argentina (AAAA-MM-DD) — para
 * filtrar orders.sale_date, que es `date` puro, nunca timestamptz.
 * startOfMonthIso() de arriba sigue sirviendo para payments/income_entries
 * (timestamptz), que no cambian de semántica en este bloque. */
function startOfMonthDateArgentina(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit" })
    .format(new Date())
    .concat("-01");
}

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

/** Everything the "Hoy" dashboard needs, in one pass. */
export async function getDashboardSummary(filters: DashboardFilters = defaultDashboardFilters()) {
  const supabase = await createClient();
  const monthStart = startOfMonthIso();
  const today = todayIso();
  const { fromIso, toIso } = dateRange(filters);

  // sale_date (Bloque 2 — "Ventas: fecha real, canal, comisiones y
  // talleres") es `date`, no timestamptz — se compara directo contra
  // filters.from/to (ya "AAAA-MM-DD"), nunca contra fromIso/toIso
  // (esos siguen siendo para payments/income_entries, que no cambian).
  let filteredOrdersQuery = supabase
    .from("orders")
    .select("id,total")
    .neq("status", "cancelled")
    .gte("sale_date", filters.from)
    .lte("sale_date", filters.to);
  if (filters.businessUnitIds) filteredOrdersQuery = filteredOrdersQuery.in("business_unit_id", filters.businessUnitIds);
  if (filters.locationId) filteredOrdersQuery = filteredOrdersQuery.eq("location_id", filters.locationId);
  if (filters.channelId) filteredOrdersQuery = filteredOrdersQuery.eq("closing_channel_id", filters.channelId);

  let filteredOrderPaymentsQuery = supabase
    .from("payments")
    .select("amount,orders!inner(status,business_unit_id,location_id,closing_channel_id)")
    .not("order_id", "is", null)
    .neq("orders.status", "cancelled")
    .gte("paid_at", fromIso)
    .lte("paid_at", toIso);
  if (filters.businessUnitIds) filteredOrderPaymentsQuery = filteredOrderPaymentsQuery.in("orders.business_unit_id", filters.businessUnitIds);
  if (filters.locationId) filteredOrderPaymentsQuery = filteredOrderPaymentsQuery.eq("orders.location_id", filters.locationId);
  if (filters.channelId) filteredOrderPaymentsQuery = filteredOrderPaymentsQuery.eq("orders.closing_channel_id", filters.channelId);

  let filteredIncomeQuery = supabase
    .from("income_entries")
    .select("amount")
    .gte("occurred_at", fromIso)
    .lte("occurred_at", toIso);
  if (filters.locationId) filteredIncomeQuery = filteredIncomeQuery.eq("location_id", filters.locationId);

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
    { data: monthOrders },
    { data: monthPayments },
    { data: monthIncomeEntries },
    { data: filteredOrders },
    { data: filteredOrderPayments },
    { data: filteredIncomeEntries },
    { count: activeOrdersCount },
    { count: overdueOrdersCount },
    { count: pendingProductionCount },
    { count: newWholesaleCount },
    { count: pendingDuesCountRaw },
    { data: pendingDueBalances },
    { data: upcomingEvents },
    classesUnit,
  ] = await Promise.all([
    supabase.from("orders").select("total").neq("status", "cancelled").gte("sale_date", startOfMonthDateArgentina()),
    supabase.from("payments").select("amount").gte("paid_at", monthStart),
    supabase.from("income_entries").select("amount").gte("occurred_at", monthStart),
    filteredOrdersQuery,
    // Joined to orders and filtered the same way as `filteredOrders` above
    // — otherwise a deposit on an order that later got cancelled (or
    // outside the filtered range/attributes) still counted as "collected"
    // against nothing.
    filteredOrderPaymentsQuery,
    filteredIncomeQuery,
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
  let dueQuery = supabase
    .from("payments")
    .select("amount,workshop_dues!inner(workshop_enrollments!inner(workshop_groups!inner(location_id)))")
    .not("workshop_due_id", "is", null)
    .gte("paid_at", fromIso)
    .lte("paid_at", toIso);
  if (filters.locationId) {
    dueQuery = dueQuery.eq("workshop_dues.workshop_enrollments.workshop_groups.location_id", filters.locationId);
  }
  const [{ data: shownDuePayments }, { data: shownEnrollments }, { data: duePaymentRows }] = await Promise.all([
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
    includeDuePayments ? dueQuery : Promise.resolve({ data: [] as never[] }),
  ]);
  const duePaymentsFiltered = includeDuePayments
    ? (duePaymentRows ?? []).reduce((sum: number, p: { amount: number }) => sum + p.amount, 0)
    : 0;

  const salesThisMonth = (monthOrders ?? []).reduce((sum, o) => sum + o.total, 0);
  // "Cobrado" es genuinamente "toda la plata que entró" — igual que
  // monthPayments (pedidos + cuotas mezclados sin distinguir unidad acá),
  // un ingreso sin producto también cuenta, nunca a "unidades vendidas".
  const collectedThisMonth =
    (monthPayments ?? []).reduce((sum, p) => sum + p.amount, 0) +
    (monthIncomeEntries ?? []).reduce((sum, e) => sum + e.amount, 0);

  const totalInvoicedFiltered = (filteredOrders ?? []).reduce((sum, o) => sum + o.total, 0);
  const orderPaymentsFiltered = (filteredOrderPayments ?? []).reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);
  const incomeEntriesFiltered = includeIncomeEntries
    ? (filteredIncomeEntries ?? []).reduce((sum: number, e: { amount: number }) => sum + e.amount, 0)
    : 0;

  const collectedFiltered = orderPaymentsFiltered + duePaymentsFiltered + incomeEntriesFiltered;
  // Pendiente de cobro es una noción exclusivamente de `orders` — nunca se
  // computa contra `collectedFiltered` (que mezcla pagos de pedidos con
  // cuotas de talleres, dos flujos de plata sin relación entre sí: una
  // cuota jamás aparece en `orders.total`). Bug real (tanda de
  // usabilidad, 2026-09-11): con "Unidad = Todas" o "classes", las cuotas
  // cobradas en el período se sumaban a `collectedFiltered` sin ningún
  // "invoiced" de cuotas del otro lado de la resta, así que plata cobrada
  // de cuotas netamente escondía saldos pendientes reales de pedidos
  // (Personalizados, Minorista, etc.) — filtrando por una unidad
  // específica no tenía ese problema porque duePaymentsFiltered daba 0.
  const pendingToCollect = Math.max(0, totalInvoicedFiltered - orderPaymentsFiltered);

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
    salesThisMonth,
    collectedThisMonth,
    pendingToCollect,
    totalInvoicedFiltered,
    collectedFiltered,
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

export type TopProductRow = { label: string; unitsSold: number; revenue: number };

export async function getTopProducts(filters: DashboardFilters = defaultDashboardFilters(), limit = 10): Promise<TopProductRow[]> {
  const supabase = await createClient();
  // A cancelled order didn't actually sell anything — exclude its items,
  // same filter used everywhere else in this file. sale_date es `date`,
  // se compara directo contra filters.from/to (Bloque 2).
  let query = supabase
    .from("order_items")
    .select("quantity,unit_price,product_variants(name,products(name)),orders!inner(status,sale_date,business_unit_id,location_id,closing_channel_id)")
    .neq("orders.status", "cancelled")
    .gte("orders.sale_date", filters.from)
    .lte("orders.sale_date", filters.to);
  if (filters.businessUnitIds) query = query.in("orders.business_unit_id", filters.businessUnitIds);
  if (filters.locationId) query = query.eq("orders.location_id", filters.locationId);
  if (filters.channelId) query = query.eq("orders.closing_channel_id", filters.channelId);
  const { data } = await query;

  const byVariant = new Map<string, TopProductRow>();
  for (const row of data ?? []) {
    const variant = row.product_variants as unknown as {
      name: string;
      products: { name: string } | null;
    } | null;
    if (!variant) continue;
    const label = variant.name === "Único" ? (variant.products?.name ?? "—") : `${variant.products?.name} — ${variant.name}`;
    const existing = byVariant.get(label) ?? { label, unitsSold: 0, revenue: 0 };
    existing.unitsSold += row.quantity;
    existing.revenue += row.quantity * row.unit_price;
    byVariant.set(label, existing);
  }

  return [...byVariant.values()].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, limit);
}

/**
 * Mix de ingresos por unidad/fuente (auditoría "Próxima evolución
 * operativa", bloque 1) — a diferencia de getMixByChannel, ESTE mix sí
 * incorpora Talleres: las cuotas de talleres son un ingreso real de un
 * "negocio" propio aunque nunca vivan en `orders`. Se suman como una
 * fuente más, con el mismo criterio de inclusión ya establecido para el
 * KPI "Cobrado del período" (getDashboardSummary): sólo cuando el filtro
 * de unidad es "Todas" o específicamente "classes", y sólo si no hay un
 * filtro de canal activo (las cuotas no tienen canal — nunca se les
 * asigna uno artificial, se excluyen en cambio). Mix POR CANAL
 * (getMixByChannel, más abajo) nunca incluye Talleres — ver su propio
 * comentario.
 */
export async function getSalesByBusinessUnit(filters: DashboardFilters = defaultDashboardFilters()) {
  const supabase = await createClient();
  const { fromIso, toIso } = dateRange(filters);
  // orders.sale_date es `date` (Bloque 2) — se compara directo contra
  // filters.from/to; fromIso/toIso siguen sirviendo para
  // getWorkshopDuePaymentsTotal (payments.paid_at, timestamptz), que no
  // cambia de semántica acá.
  let query = supabase
    .from("orders")
    .select("total,business_units(name)")
    .neq("status", "cancelled")
    .gte("sale_date", filters.from)
    .lte("sale_date", filters.to);
  if (filters.businessUnitIds) query = query.in("business_unit_id", filters.businessUnitIds);
  if (filters.locationId) query = query.eq("location_id", filters.locationId);
  if (filters.channelId) query = query.eq("closing_channel_id", filters.channelId);

  // classesUnit no depende de `query` ni viceversa — corren juntas
  // (antes classesUnit se esperaba sola, primero) (perf audit H-03).
  // getClassesUnit() está cacheada por request: si getDashboardSummary
  // ya la pidió en esta misma navegación (se llaman juntas desde
  // dashboard/page.tsx), esto no dispara una segunda query real.
  const [{ data }, classesUnit] = await Promise.all([query, getClassesUnit()]);
  const includeWorkshops =
    (filters.businessUnitIds == null || (classesUnit != null && filters.businessUnitIds.includes(classesUnit.id))) &&
    filters.channelId == null;

  const workshopsTotal = includeWorkshops
    ? await getWorkshopDuePaymentsTotal(supabase, fromIso, toIso, filters.locationId)
    : 0;

  const byUnit = new Map<string, number>();
  for (const row of data ?? []) {
    const unit = (row.business_units as unknown as { name: string } | null)?.name ?? "Sin unidad";
    byUnit.set(unit, (byUnit.get(unit) ?? 0) + row.total);
  }
  if (includeWorkshops && workshopsTotal > 0) {
    const label = classesUnit?.name ?? "Talleres";
    byUnit.set(label, (byUnit.get(label) ?? 0) + workshopsTotal);
  }
  return [...byUnit.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
}

/** Cuotas de talleres cobradas en el rango — mismo join de 3 niveles ya
 * usado en getDashboardSummary para el filtro de ubicación. */
async function getWorkshopDuePaymentsTotal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fromIso: string,
  toIso: string,
  locationId: string | null
): Promise<number> {
  let dueQuery = supabase
    .from("payments")
    .select("amount,workshop_dues!inner(workshop_enrollments!inner(workshop_groups!inner(location_id)))")
    .not("workshop_due_id", "is", null)
    .gte("paid_at", fromIso)
    .lte("paid_at", toIso);
  if (locationId) {
    dueQuery = dueQuery.eq("workshop_dues.workshop_enrollments.workshop_groups.location_id", locationId);
  }
  const { data } = await dueQuery;
  return (data ?? []).reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);
}

/**
 * Mix de ventas por canal de cierre — sección 8, sólo para composición
 * (donut), nunca la única vista de una serie temporal. `orders` tiene
 * DOS FKs a `sales_channels` (origin_channel_id y closing_channel_id) —
 * PostgREST rechaza un embed `sales_channels(name)` ambiguo
 * (PGRST201) si no se nombra la FK exacta.
 *
 * A diferencia de getSalesByBusinessUnit, este mix NUNCA incorpora
 * Talleres (ni, más adelante, Otros ingresos) — ninguno de los dos tiene
 * un canal real. "Por canal" es semánticamente distinto de "por unidad/
 * fuente" (auditoría "Próxima evolución operativa", bloque 1): mezclar
 * ambos asignándole un canal artificial a las cuotas ensuciaría esta
 * vista con datos que no representan un canal de cierre real.
 */
export async function getMixByChannel(filters: DashboardFilters = defaultDashboardFilters()) {
  const supabase = await createClient();
  // sale_date es `date` (Bloque 2) — se compara directo contra filters.from/to.
  let query = supabase
    .from("orders")
    .select("total,sales_channels!orders_closing_channel_id_fkey(name)")
    .neq("status", "cancelled")
    .gte("sale_date", filters.from)
    .lte("sale_date", filters.to);
  if (filters.businessUnitIds) query = query.in("business_unit_id", filters.businessUnitIds);
  if (filters.locationId) query = query.eq("location_id", filters.locationId);
  if (filters.channelId) query = query.eq("closing_channel_id", filters.channelId);
  const { data } = await query;

  const byChannel = new Map<string, number>();
  for (const row of data ?? []) {
    const channel = (row.sales_channels as unknown as { name: string } | null)?.name ?? "Sin canal";
    byChannel.set(channel, (byChannel.get(channel) ?? 0) + row.total);
  }
  return [...byChannel.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
}

export type SalesOverTimePoint = { bucket: string; total: number };

/**
 * Ventas en el tiempo — bucket diario si el rango es corto (≤62 días,
 * cómodo de leer en un gráfico de barras), mensual si es más largo (un
 * año entero en barras diarias sería ilegible).
 *
 * Agrupa por `sale_date` (Bloque 2 — "Ventas: fecha real, canal,
 * comisiones y talleres") — nunca por `created_at` ni por `sold_at`.
 * `sale_date` es la fecha comercial declarada, editable, la única que
 * puede reflejar una venta cargada retroactivamente ("cargué hoy una
 * venta de hace tres días" imputa al día real, no al de carga).
 *
 * `sold_at` describía "cuándo pasó técnicamente a delivered" — ese
 * filtro implícito (sólo pedidos entregados, nunca uno en curso) se
 * preserva acá con un `eq("status","delivered")` explícito, porque nada
 * de esa semántica cambió: un pedido todavía en curso sigue sin ser una
 * venta todavía, sólo que ahora el filtro lo dice directamente en vez de
 * apoyarse en que sold_at sólo existe para los entregados.
 */
export async function getSalesOverTime(filters: DashboardFilters = defaultDashboardFilters()): Promise<SalesOverTimePoint[]> {
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select("total,sale_date")
    .eq("status", "delivered")
    .gte("sale_date", filters.from)
    .lte("sale_date", filters.to);
  if (filters.businessUnitIds) query = query.in("business_unit_id", filters.businessUnitIds);
  if (filters.locationId) query = query.eq("location_id", filters.locationId);
  if (filters.channelId) query = query.eq("closing_channel_id", filters.channelId);
  const { data } = await query;

  const fromDate = new Date(`${filters.from}T00:00:00Z`);
  const toDate = new Date(`${filters.to}T00:00:00Z`);
  const daySpan = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1);
  const monthly = daySpan > 62;

  // sale_date ya es "AAAA-MM-DD" en fecha calendario, sin componente
  // horario — a diferencia del bucketOf anterior (que parseaba un
  // timestamptz con Intl.DateTimeFormat para no correrse de día por el
  // huso horario), acá no hace falta ninguna conversión: es exactamente
  // el motivo por el que sale_date es `date` y no timestamptz.
  const bucketOf = (dateOnly: string) => (monthly ? dateOnly.slice(0, 7) : dateOnly);

  const totals = new Map<string, number>();
  for (const row of data ?? []) {
    // sale_date es not null siempre — a diferencia de sold_at, nunca
    // hace falta este guard por otro motivo que TypeScript no lo sepa.
    if (!row.sale_date) continue;
    const bucket = bucketOf(row.sale_date);
    totals.set(bucket, (totals.get(bucket) ?? 0) + row.total);
  }
  return [...totals.entries()].map(([bucket, total]) => ({ bucket, total })).sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export async function getWholesaleConversion() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("status,business_units!inner(code)")
    .eq("business_units.code", "wholesale");

  const total = data?.length ?? 0;
  const confirmed = (data ?? []).filter((o) => o.status !== "pending" && o.status !== "cancelled").length;

  return { total, confirmed, conversionRate: total > 0 ? confirmed / total : 0 };
}

export async function getProductionCounts() {
  const supabase = await createClient();
  const { data } = await supabase.from("production_orders").select("status");

  const byStatus = new Map<string, number>();
  for (const row of data ?? []) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
  }
  return byStatus;
}
