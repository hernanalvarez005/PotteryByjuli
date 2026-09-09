import { createClient } from "@/lib/supabase/server";

function startOfMonthIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Everything the "Hoy" dashboard needs, in one pass. */
export async function getDashboardSummary() {
  const supabase = await createClient();
  const monthStart = startOfMonthIso();
  const today = todayIso();

  const [
    { data: monthOrders },
    { data: monthPayments },
    { data: allOrders },
    { data: allPayments },
    { count: activeOrdersCount },
    { count: overdueOrdersCount },
    { count: pendingProductionCount },
    { count: newWholesaleCount },
    { count: pendingDuesCount },
    { data: upcomingEvents },
  ] = await Promise.all([
    supabase.from("orders").select("total").neq("status", "cancelled").gte("created_at", monthStart),
    supabase.from("payments").select("amount").gte("paid_at", monthStart),
    supabase.from("orders").select("id,total").neq("status", "cancelled"),
    // Joined to orders and filtered the same way as `allOrders` above —
    // otherwise a deposit on an order that later got cancelled still
    // counted as "collected" against nothing, silently under-stating
    // pendingToCollect (it was even possible for it to make totalCollected
    // exceed totalInvoiced, masked by the Math.max(0, …) clamp below).
    supabase.from("payments").select("amount,orders!inner(status)").neq("orders.status", "cancelled"),
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
    supabase.from("workshop_dues").select("id", { count: "exact", head: true }).eq("is_paid", false),
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
  const totalInvoiced = (allOrders ?? []).reduce((sum, o) => sum + o.total, 0);
  const totalCollected = (allPayments ?? []).reduce((sum, p) => sum + p.amount, 0);

  return {
    salesThisMonth,
    collectedThisMonth,
    pendingToCollect: Math.max(0, totalInvoiced - totalCollected),
    activeOrdersCount: activeOrdersCount ?? 0,
    overdueOrdersCount: overdueOrdersCount ?? 0,
    pendingProductionCount: pendingProductionCount ?? 0,
    newWholesaleCount: newWholesaleCount ?? 0,
    pendingDuesCount: pendingDuesCount ?? 0,
    upcomingEvents: upcomingEvents ?? [],
  };
}

export type TopProductRow = { label: string; unitsSold: number; revenue: number };

export async function getTopProducts(limit = 10): Promise<TopProductRow[]> {
  const supabase = await createClient();
  // A cancelled order didn't actually sell anything — exclude its items,
  // same filter used everywhere else in this file (getSalesByBusinessUnit,
  // getDashboardSummary), so "most sold" and "revenue" agree with them.
  const { data } = await supabase
    .from("order_items")
    .select("quantity,unit_price,product_variants(name,products(name)),orders!inner(status)")
    .neq("orders.status", "cancelled");

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

export async function getSalesByBusinessUnit() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("total,business_units(name)")
    .neq("status", "cancelled");

  const byUnit = new Map<string, number>();
  for (const row of data ?? []) {
    const unit = (row.business_units as unknown as { name: string } | null)?.name ?? "Sin unidad";
    byUnit.set(unit, (byUnit.get(unit) ?? 0) + row.total);
  }
  return [...byUnit.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
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
