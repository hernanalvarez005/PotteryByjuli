import Link from "next/link";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getDashboardSummary,
  getSalesOverTime,
  getTopProducts,
  getSalesByBusinessUnit,
  getMixByChannel,
  defaultDashboardFilters,
  type DashboardFilters,
} from "@/lib/reports";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DashboardFilters as DashboardFiltersBar } from "./dashboard-filters";
import { SalesOverTimeChart } from "./sales-over-time-chart";
import { TopProductsChart } from "./top-products-chart";
import { MixDonutChart } from "./mix-donut-chart";

const ROLE_LABELS: Record<string, string> = {
  owner: "Dueña",
  operations: "Operaciones",
  workshop_staff: "Taller",
  viewer: "Solo lectura",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; unit?: string; location?: string; channel?: string }>;
}) {
  const user = await requireUser();
  const hasAnyRole = user.roles.length > 0;
  const canSeeFinance = isOwner(user) || hasRole(user, "operations");

  const params = await searchParams;
  const defaults = defaultDashboardFilters();
  const filters: DashboardFilters = {
    from: params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : defaults.from,
    to: params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : defaults.to,
    businessUnitId: params.unit ?? null,
    locationId: params.location ?? null,
    channelId: params.channel ?? null,
  };

  const supabase = await createClient();
  const [
    summary,
    salesOverTime,
    topProducts,
    salesByUnit,
    mixByChannel,
    { data: businessUnits },
    { data: locations },
    { data: channels },
  ] = hasAnyRole && canSeeFinance
    ? await Promise.all([
        getDashboardSummary(filters),
        getSalesOverTime(filters),
        getTopProducts(filters),
        getSalesByBusinessUnit(filters),
        getMixByChannel(filters),
        supabase.from("business_units").select("id,name").eq("is_active", true).order("name"),
        supabase.from("locations").select("id,name").eq("is_active", true).order("name"),
        supabase.from("sales_channels").select("id,name").eq("is_active", true).order("name"),
      ])
    : hasAnyRole
      ? [await getDashboardSummary(filters), [], [], [], [], { data: [] }, { data: [] }, { data: [] }]
      : [null, [], [], [], [], { data: [] }, { data: [] }, { data: [] }];

  const attentionItems = summary
    ? [
        summary.overdueOrdersCount > 0 && {
          label: `${summary.overdueOrdersCount} pedido${summary.overdueOrdersCount > 1 ? "s" : ""} atrasado${summary.overdueOrdersCount > 1 ? "s" : ""}`,
          href: "/pedidos",
        },
        summary.newWholesaleCount > 0 && {
          label: `${summary.newWholesaleCount} solicitud${summary.newWholesaleCount > 1 ? "es" : ""} mayorista${summary.newWholesaleCount > 1 ? "s" : ""} sin revisar`,
          href: "/mayoristas",
        },
        summary.pendingProductionCount > 0 && {
          label: `${summary.pendingProductionCount} orden${summary.pendingProductionCount > 1 ? "es" : ""} de producción activa${summary.pendingProductionCount > 1 ? "s" : ""}`,
          href: "/produccion",
        },
        summary.pendingDuesCount > 0 && {
          label: `${summary.pendingDuesCount} cuota${summary.pendingDuesCount > 1 ? "s" : ""} de taller pendiente${summary.pendingDuesCount > 1 ? "s" : ""}`,
          href: "/talleres",
        },
      ].filter((v): v is { label: string; href: string } => Boolean(v))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hola{user.fullName ? `, ${user.fullName}` : ""} 👋
        </h1>
        <p className="text-muted-foreground">Este es el resumen operativo de Pottery.</p>
      </div>

      {!hasAnyRole && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
          <CardHeader>
            <CardTitle className="text-base">Tu usuario todavía no tiene un rol asignado</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Pedile a quien administra Pottery que te asigne un rol (Dueña,
            Operaciones, Taller o Solo lectura) desde la tabla{" "}
            <code className="rounded bg-background px-1 py-0.5">user_roles</code> en
            Supabase.
          </CardContent>
        </Card>
      )}

      {hasAnyRole && (
        <div className="flex gap-2">
          {user.roles.map((role) => (
            <Badge key={role} variant="secondary">
              {ROLE_LABELS[role] ?? role}
            </Badge>
          ))}
        </div>
      )}

      {summary && canSeeFinance && (
        <DashboardFiltersBar
          businessUnits={businessUnits ?? []}
          locations={locations ?? []}
          channels={channels ?? []}
          defaultFrom={filters.from}
          defaultTo={filters.to}
        />
      )}

      {summary && canSeeFinance && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Kpi label="Ventas del período" value={formatCurrency(summary.totalInvoicedFiltered)} />
          <Kpi label="Cobrado del período" value={formatCurrency(summary.collectedFiltered)} />
          <Kpi label="Pendiente de cobro" value={formatCurrency(summary.pendingToCollect)} />
          <Kpi label="Pedidos activos" value={String(summary.activeOrdersCount)} />
        </div>
      )}

      {summary && canSeeFinance && summary.duesExcludedByChannelFilter && (
        <p className="text-xs text-muted-foreground">
          Las cuotas de talleres no tienen canal asociado y no se incluyen en estos totales mientras el filtro de canal esté activo.
        </p>
      )}

      {summary && canSeeFinance && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SalesOverTimeChart data={salesOverTime} />
          <MixDonutChart byUnit={salesByUnit} byChannel={mixByChannel} />
          <div className="lg:col-span-2">
            <TopProductsChart data={topProducts} />
          </div>
        </div>
      )}

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Necesita atención</CardTitle>
          </CardHeader>
          <CardContent>
            {attentionItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada pendiente por ahora.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {attentionItems.map((item) => (
                  <li key={item.label}>
                    <Link href={item.href} className="hover:underline">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {summary && summary.upcomingEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Próximos eventos</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {summary.upcomingEvents.map((e) => (
                <li key={e.id}>
                  <Link href={`/eventos/${e.id}`} className="hover:underline">
                    {e.name}
                  </Link>{" "}
                  <span className="text-muted-foreground">— {formatDate(e.event_date)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {!summary && hasAnyRole && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Todavía no hay datos que mostrar</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Empezá cargando algo en{" "}
            <Link href="/configuracion" className="underline underline-offset-2">
              Configuración
            </Link>
            .
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-xl font-semibold">{value}</CardContent>
    </Card>
  );
}
