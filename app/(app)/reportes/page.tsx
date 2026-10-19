import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFinishedGoodsStock } from "@/lib/inventory";
import {
  getTopProducts,
  getSalesByBusinessUnit,
  getMixByChannel,
  getSalesOverTime,
  getReportKpis,
  getWholesaleConversion,
  getProductionCounts,
  getIncomeEntriesSummary,
  getUnitsSoldForSelection,
  getModelsByIds,
  getFirstActivityDate,
} from "@/lib/reports";
import { defaultReportFilters, parseIdList, parseReportFilters, seriesFrom, type ReportSearchParams } from "@/lib/report-filters";
import { collectedVsPending, MAX_SELECTED_MODELS } from "@/lib/report-view";
import { formatCurrency } from "@/lib/format";
import { PRODUCTION_STATUS_LABELS } from "@/schemas/production";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardFilters as ReportFiltersBar } from "../dashboard/dashboard-filters";
import { Kpi, KpiCurrency } from "../dashboard/kpi";
import { MixDonutChart } from "../dashboard/mix-donut-chart";
import { TopProductsChart } from "../dashboard/top-products-chart";
import { SalesTimeChart } from "./sales-time-chart";
import { CollectedVsPendingChart } from "./collected-vs-pending-chart";
import { ModelGroupCard } from "./model-group-card";

const dmy = (date: string) => date.split("-").reverse().join("/");

export default async function ReportesPage({ searchParams }: { searchParams: Promise<ReportSearchParams> }) {
  const user = await requireUser();
  const canView = isOwner(user) || hasRole(user, "operations");

  if (!canView) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        No tenés permiso para ver reportes.
      </p>
    );
  }

  const params = await searchParams;
  const filters = parseReportFilters(params, defaultReportFilters());
  const modelIds = parseIdList(params.models, MAX_SELECTED_MODELS);
  const supabase = await createClient();

  // La serie arranca en la primera actividad real: con "todo el histórico" (desde 2000) no genera
  // cientos de meses en 0. Los KPI usan el rango pedido tal cual.
  const firstActivity = await getFirstActivityDate();
  const seriesFilters = { ...filters, from: seriesFrom(filters.from, firstActivity) };

  const [
    kpis,
    series,
    salesByUnit,
    mixByChannel,
    topProducts,
    selection,
    selectedModels,
    otherIncome,
    wholesale,
    productionCounts,
    stockRows,
    { data: businessUnits },
    { data: locations },
    { data: channels },
  ] = await Promise.all([
    getReportKpis(filters),
    getSalesOverTime(seriesFilters),
    getSalesByBusinessUnit(filters),
    getMixByChannel(filters),
    getTopProducts(filters, 20),
    getUnitsSoldForSelection(filters, { productIds: modelIds }),
    getModelsByIds(modelIds),
    getIncomeEntriesSummary(filters),
    getWholesaleConversion(),
    getProductionCounts(),
    getFinishedGoodsStock(),
    supabase.from("business_units").select("id,name").eq("is_active", true).order("name"),
    supabase.from("locations").select("id,name").eq("is_active", true).order("name"),
    supabase.from("sales_channels").select("id,name").eq("is_active", true).order("name"),
  ]);

  const criticalStock = stockRows.filter((r) => r.available <= 0 || (r.minQuantity != null && r.available <= r.minQuantity));
  const split = collectedVsPending(kpis);
  const periodLabel = `${dmy(filters.from)} al ${dmy(filters.to)}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reportes</h1>
        <p className="text-muted-foreground">Del {periodLabel}. Cambiá el período y los filtros para recalcular todo.</p>
      </div>

      <ReportFiltersBar
        businessUnits={businessUnits ?? []}
        locations={locations ?? []}
        channels={channels ?? []}
        defaultFrom={filters.from}
        defaultTo={filters.to}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCurrency label="Facturación" amount={kpis.invoiced} />
        <KpiCurrency label="Cobrado" amount={kpis.collectedTotal} />
        <KpiCurrency label="Pendiente de cobro" amount={kpis.cohortPending} />
        <Kpi label="Ticket promedio" value={kpis.avgTicket == null ? "—" : formatCurrency(kpis.avgTicket)} />
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>
          {kpis.ordersCount} {kpis.ordersCount === 1 ? "pedido facturado" : "pedidos facturados"} en el período · Pendiente total de
          cobrar (todos los pedidos, sin importar la fecha): {formatCurrency(kpis.pendingTotalAll)} en {kpis.pendingOrdersAll}{" "}
          {kpis.pendingOrdersAll === 1 ? "pedido" : "pedidos"}.
        </p>
        {kpis.collectedWorkshops > 0 && (
          <p>
            Talleres: {formatCurrency(kpis.collectedWorkshops)} de cuotas cobradas — están en &quot;Cobrado&quot;, no en
            &quot;Facturación&quot;.
          </p>
        )}
        {kpis.collectedOther > 0 && <p>Otros ingresos: {formatCurrency(kpis.collectedOther)} — están en &quot;Cobrado&quot;.</p>}
        {kpis.collectedOnCancelled > 0 && (
          <p>
            Hay {formatCurrency(kpis.collectedOnCancelled)} cobrados en pedidos cancelados: no están en &quot;Cobrado&quot; — revisalos en
            Pagos.
          </p>
        )}
        <details className="mt-1">
          <summary className="w-fit cursor-pointer underline underline-offset-2">Cómo se calcula</summary>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
            <li>
              <strong>Facturación:</strong> pedidos no cancelados del período, por fecha de venta (incluye ventas rápidas).
            </li>
            <li>
              <strong>Cobrado:</strong> la plata que entró en el período, por fecha de pago (pedidos no cancelados, cuotas de taller y
              otros ingresos).
            </li>
            <li>
              <strong>Pendiente de cobro:</strong> lo que todavía se debe de lo facturado en el período.
            </li>
            <li>
              <strong>Ticket promedio:</strong> facturación ÷ pedidos (no incluye talleres ni otros ingresos).
            </li>
            <li>El cobrado puede superar a la facturación: se cobraron deudas de períodos anteriores.</li>
          </ul>
        </details>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <SalesTimeChart data={series} />
        </div>
        <MixDonutChart byUnit={salesByUnit} byChannel={mixByChannel} />
        <CollectedVsPendingChart data={split} />
        <div className="lg:col-span-2">
          <TopProductsChart data={topProducts.slice(0, 10)} />
        </div>
      </div>

      <ModelGroupCard
        selected={selectedModels}
        rows={selection.rows}
        totalUnits={selection.totalUnits}
        totalRevenue={selection.totalRevenue}
        periodLabel={periodLabel}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalle de productos más vendidos</CardTitle>
        </CardHeader>
        <CardContent>
          {topProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ventas en este período.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Unidades vendidas</TableHead>
                  <TableHead className="text-right">Facturación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topProducts.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell className="whitespace-normal font-medium">{p.label}</TableCell>
                    <TableCell className="text-right">{p.unitsSold}</TableCell>
                    <TableCell className="text-right">{formatCurrency(p.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Los ítems a medida (sin producto del catálogo) van juntos en &quot;Ítems a medida&quot;. Facturación = cantidad × precio, antes del
            descuento global del pedido.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mayoristas (histórico)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Solicitudes recibidas</span>
              <span className="font-medium">{wholesale.total}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Confirmadas</span>
              <span className="font-medium">{wholesale.confirmed}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Conversión</span>
              <span className="font-medium">{Math.round(wholesale.conversionRate * 100)}%</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Producción (histórico)</CardTitle>
          </CardHeader>
          <CardContent>
            {productionCounts.size === 0 ? (
              <p className="text-sm text-muted-foreground">Sin órdenes todavía.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {[...productionCounts.entries()].map(([status, count]) => (
                  <li key={status} className="flex justify-between">
                    <span className="text-muted-foreground">{PRODUCTION_STATUS_LABELS[status] ?? status}</span>
                    <span className="font-medium">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Otros ingresos</CardTitle>
          </CardHeader>
          <CardContent>
            {otherIncome.count === 0 ? (
              <p className="text-sm text-muted-foreground">Sin ingresos cargados en este período.</p>
            ) : (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total ({otherIncome.count})</span>
                  <span className="font-medium">{formatCurrency(otherIncome.total)}</span>
                </div>
                <ul className="mt-2 flex flex-col gap-1 border-t pt-2 text-sm">
                  {otherIncome.byCategory.slice(0, 5).map((c) => (
                    <li key={c.category} className="flex justify-between">
                      <span className="text-muted-foreground">{c.category}</span>
                      <span>{formatCurrency(c.total)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock crítico (hoy)</CardTitle>
          </CardHeader>
          <CardContent>
            {criticalStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todo el stock está en niveles normales.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {criticalStock.slice(0, 10).map((r) => (
                  <li key={`${r.inventoryItemId}:${r.locationId}`} className="flex justify-between">
                    <span>
                      {r.productLabel} <span className="text-muted-foreground">({r.locationName})</span>
                    </span>
                    <span className="font-medium text-amber-600">{r.available}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
