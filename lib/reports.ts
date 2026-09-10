import { createClient } from "@/lib/supabase/server";
import { computeDueSummary } from "@/lib/workshop-dues";
import {
  dateOnlyToArgentinaStartOfDayISO,
  dateOnlyToArgentinaEndOfDayISO,
  todayInArgentina,
} from "@/lib/format";

function startOfMonthIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
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
  businessUnitId: string | null;
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
  return { from: monthStart, to: todayInArgentina(), businessUnitId: null, locationId: null, channelId: null };
}

/**
 * "Todo el histórico, no sólo el mes actual" (/reportes) — un rango
 * deliberadamente amplio, no un caso especial de "sin fecha" en cada
 * función: las mismas funciones filtradas por fecha que usa el
 * dashboard sirven para el histórico completo con este único filtro.
 */
export function allTimeDashboardFilters(): DashboardFilters {
  return { from: "2000-01-01", to: todayInArgentina(), businessUnitId: null, locationId: null, channelId: null };
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

  const { data: classesUnit } = await supabase
    .from("business_units")
    .select("id")
    .eq("code", "classes")
    .maybeSingle();
  const classesUnitId = classesUnit?.id ?? null;
  // Las cuotas de talleres no tienen business_unit_id propio — sólo
  // corresponde incluirlas cuando el filtro es "Todas" o específicamente
  // "classes" (decisión de arquitectura de esta tanda).
  const includeDuesInFilter = filters.businessUnitId == null || filters.businessUnitId === classesUnitId;
  // Tampoco tienen canal — un filtro de canal activo las excluye siempre
  // (se avisa explícitamente en la UI, nunca parece un bug silencioso).
  const includeDuePayments = includeDuesInFilter && filters.channelId == null;

  let filteredOrdersQuery = supabase
    .from("orders")
    .select("id,total")
    .neq("status", "cancelled")
    .gte("created_at", fromIso)
    .lte("created_at", toIso);
  if (filters.businessUnitId) filteredOrdersQuery = filteredOrdersQuery.eq("business_unit_id", filters.businessUnitId);
  if (filters.locationId) filteredOrdersQuery = filteredOrdersQuery.eq("location_id", filters.locationId);
  if (filters.channelId) filteredOrdersQuery = filteredOrdersQuery.eq("closing_channel_id", filters.channelId);

  let filteredOrderPaymentsQuery = supabase
    .from("payments")
    .select("amount,orders!inner(status,business_unit_id,location_id,closing_channel_id)")
    .not("order_id", "is", null)
    .neq("orders.status", "cancelled")
    .gte("paid_at", fromIso)
    .lte("paid_at", toIso);
  if (filters.businessUnitId) filteredOrderPaymentsQuery = filteredOrderPaymentsQuery.eq("orders.business_unit_id", filters.businessUnitId);
  if (filters.locationId) filteredOrderPaymentsQuery = filteredOrderPaymentsQuery.eq("orders.location_id", filters.locationId);
  if (filters.channelId) filteredOrderPaymentsQuery = filteredOrderPaymentsQuery.eq("orders.closing_channel_id", filters.channelId);

  const [
    { data: monthOrders },
    { data: monthPayments },
    { data: filteredOrders },
    { data: filteredOrderPayments },
    { count: activeOrdersCount },
    { count: overdueOrdersCount },
    { count: pendingProductionCount },
    { count: newWholesaleCount },
    { data: allDueRows },
    { data: upcomingEvents },
  ] = await Promise.all([
    supabase.from("orders").select("total").neq("status", "cancelled").gte("created_at", monthStart),
    supabase.from("payments").select("amount").gte("paid_at", monthStart),
    filteredOrdersQuery,
    // Joined to orders and filtered the same way as `filteredOrders` above
    // — otherwise a deposit on an order that later got cancelled (or
    // outside the filtered range/attributes) still counted as "collected"
    // against nothing.
    filteredOrderPaymentsQuery,
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
    // is_paid ya no existe (Fase workshop_monthly_dues la reemplazó por
    // un estado siempre derivado) — computeDueSummary abajo es la única
    // fuente de verdad, igual que en Talleres/ficha de alumna.
    supabase.from("workshop_dues").select("amount,status,payments(amount),workshop_due_items(amount,voided_at)"),
    supabase
      .from("events")
      .select("id,human_code,name,event_date,event_type")
      .gte("event_date", today)
      .neq("status", "cancelled")
      .order("event_date")
      .limit(5),
  ]);

  const salesThisMonth = (monthOrders ?? []).reduce((sum, o) => sum + o.total, 0);
  const collectedThisMonth = (monthPayments ?? []).reduce((sum, p) => sum + p.amount, 0);

  const totalInvoicedFiltered = (filteredOrders ?? []).reduce((sum, o) => sum + o.total, 0);
  const orderPaymentsFiltered = (filteredOrderPayments ?? []).reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);

  let duePaymentsFiltered = 0;
  if (includeDuePayments) {
    let dueQuery = supabase
      .from("payments")
      .select(
        "amount,workshop_dues!inner(workshop_enrollments!inner(workshop_groups!inner(location_id)))"
      )
      .not("workshop_due_id", "is", null)
      .gte("paid_at", fromIso)
      .lte("paid_at", toIso);
    if (filters.locationId) {
      dueQuery = dueQuery.eq("workshop_dues.workshop_enrollments.workshop_groups.location_id", filters.locationId);
    }
    const { data: duePaymentRows } = await dueQuery;
    duePaymentsFiltered = (duePaymentRows ?? []).reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);
  }

  const collectedFiltered = orderPaymentsFiltered + duePaymentsFiltered;

  // computeDueSummary (lib/workshop-dues.ts) es la única fuente de verdad
  // para el estado de una cuota — Talleres, la ficha de alumna y esto
  // calculan exactamente lo mismo, nunca una columna is_paid separada.
  // No se filtra por período/atributo: es un conteo de "ahora mismo",
  // como el resto de "Necesita atención".
  const pendingDuesCount = (allDueRows ?? []).filter((d) => {
    const summary = computeDueSummary(
      { status: d.status as "pending" | "cancelled", amount: d.amount },
      (d.workshop_due_items ?? []) as { amount: number; voided_at: string | null }[],
      (d.payments ?? []) as { amount: number }[]
    );
    return summary.status === "pending" || summary.status === "partial";
  }).length;

  return {
    salesThisMonth,
    collectedThisMonth,
    pendingToCollect: Math.max(0, totalInvoicedFiltered - collectedFiltered),
    totalInvoicedFiltered,
    collectedFiltered,
    duesExcludedByChannelFilter: includeDuesInFilter && !includeDuePayments,
    activeOrdersCount: activeOrdersCount ?? 0,
    overdueOrdersCount: overdueOrdersCount ?? 0,
    pendingProductionCount: pendingProductionCount ?? 0,
    newWholesaleCount: newWholesaleCount ?? 0,
    pendingDuesCount,
    upcomingEvents: upcomingEvents ?? [],
  };
}

export type TopProductRow = { label: string; unitsSold: number; revenue: number };

export async function getTopProducts(filters: DashboardFilters = defaultDashboardFilters(), limit = 10): Promise<TopProductRow[]> {
  const supabase = await createClient();
  const { fromIso, toIso } = dateRange(filters);
  // A cancelled order didn't actually sell anything — exclude its items,
  // same filter used everywhere else in this file.
  let query = supabase
    .from("order_items")
    .select("quantity,unit_price,product_variants(name,products(name)),orders!inner(status,created_at,business_unit_id,location_id,closing_channel_id)")
    .neq("orders.status", "cancelled")
    .gte("orders.created_at", fromIso)
    .lte("orders.created_at", toIso);
  if (filters.businessUnitId) query = query.eq("orders.business_unit_id", filters.businessUnitId);
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

export async function getSalesByBusinessUnit(filters: DashboardFilters = defaultDashboardFilters()) {
  const supabase = await createClient();
  const { fromIso, toIso } = dateRange(filters);
  let query = supabase
    .from("orders")
    .select("total,business_units(name)")
    .neq("status", "cancelled")
    .gte("created_at", fromIso)
    .lte("created_at", toIso);
  if (filters.businessUnitId) query = query.eq("business_unit_id", filters.businessUnitId);
  if (filters.locationId) query = query.eq("location_id", filters.locationId);
  if (filters.channelId) query = query.eq("closing_channel_id", filters.channelId);
  const { data } = await query;

  const byUnit = new Map<string, number>();
  for (const row of data ?? []) {
    const unit = (row.business_units as unknown as { name: string } | null)?.name ?? "Sin unidad";
    byUnit.set(unit, (byUnit.get(unit) ?? 0) + row.total);
  }
  return [...byUnit.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
}

/**
 * Mix de ventas por canal de cierre — sección 8, sólo para composición
 * (donut), nunca la única vista de una serie temporal. `orders` tiene
 * DOS FKs a `sales_channels` (origin_channel_id y closing_channel_id) —
 * PostgREST rechaza un embed `sales_channels(name)` ambiguo
 * (PGRST201) si no se nombra la FK exacta.
 */
export async function getMixByChannel(filters: DashboardFilters = defaultDashboardFilters()) {
  const supabase = await createClient();
  const { fromIso, toIso } = dateRange(filters);
  let query = supabase
    .from("orders")
    .select("total,sales_channels!orders_closing_channel_id_fkey(name)")
    .neq("status", "cancelled")
    .gte("created_at", fromIso)
    .lte("created_at", toIso);
  if (filters.businessUnitId) query = query.eq("business_unit_id", filters.businessUnitId);
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
 */
export async function getSalesOverTime(filters: DashboardFilters = defaultDashboardFilters()): Promise<SalesOverTimePoint[]> {
  const supabase = await createClient();
  const { fromIso, toIso } = dateRange(filters);
  let query = supabase
    .from("orders")
    .select("total,created_at")
    .neq("status", "cancelled")
    .gte("created_at", fromIso)
    .lte("created_at", toIso);
  if (filters.businessUnitId) query = query.eq("business_unit_id", filters.businessUnitId);
  if (filters.locationId) query = query.eq("location_id", filters.locationId);
  if (filters.channelId) query = query.eq("closing_channel_id", filters.channelId);
  const { data } = await query;

  const fromDate = new Date(`${filters.from}T00:00:00Z`);
  const toDate = new Date(`${filters.to}T00:00:00Z`);
  const daySpan = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1);
  const monthly = daySpan > 62;

  const bucketOf = (iso: string) => {
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
    return monthly ? local.slice(0, 7) : local;
  };

  const totals = new Map<string, number>();
  for (const row of data ?? []) {
    const bucket = bucketOf(row.created_at);
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
