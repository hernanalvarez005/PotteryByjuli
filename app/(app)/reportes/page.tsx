import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getFinishedGoodsStock } from "@/lib/inventory";
import {
  getTopProducts,
  getSalesByBusinessUnit,
  getWholesaleConversion,
  getProductionCounts,
} from "@/lib/reports";
import { formatCurrency } from "@/lib/format";
import { PRODUCTION_STATUS_LABELS } from "@/schemas/production";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function ReportesPage() {
  const user = await requireUser();
  const canView = isOwner(user) || hasRole(user, "operations");

  if (!canView) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        No tenés permiso para ver reportes.
      </p>
    );
  }

  const [topProducts, salesByUnit, wholesale, productionCounts, stockRows] = await Promise.all([
    getTopProducts(),
    getSalesByBusinessUnit(),
    getWholesaleConversion(),
    getProductionCounts(),
    getFinishedGoodsStock(),
  ]);

  const criticalStock = stockRows.filter((r) => r.available <= 0 || (r.minQuantity != null && r.available <= r.minQuantity));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reportes</h1>
        <p className="text-muted-foreground">Todo el histórico, no sólo el mes actual.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ventas por unidad de negocio</CardTitle>
          </CardHeader>
          <CardContent>
            {salesByUnit.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin ventas todavía.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {salesByUnit.map((u) => (
                  <li key={u.name} className="flex justify-between">
                    <span className="text-muted-foreground">{u.name}</span>
                    <span className="font-medium">{formatCurrency(u.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mayoristas</CardTitle>
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
            <CardTitle className="text-base">Producción</CardTitle>
          </CardHeader>
          <CardContent>
            {productionCounts.size === 0 ? (
              <p className="text-sm text-muted-foreground">Sin órdenes todavía.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {[...productionCounts.entries()].map(([status, count]) => (
                  <li key={status} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {PRODUCTION_STATUS_LABELS[status] ?? status}
                    </span>
                    <span className="font-medium">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock crítico</CardTitle>
          </CardHeader>
          <CardContent>
            {criticalStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todo el stock está en niveles normales.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {criticalStock.slice(0, 10).map((r) => (
                  <li key={`${r.inventoryItemId}:${r.locationId}`} className="flex justify-between">
                    <span>
                      {r.productLabel}{" "}
                      <span className="text-muted-foreground">({r.locationName})</span>
                    </span>
                    <span className="font-medium text-amber-600">{r.available}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Productos más vendidos</CardTitle>
        </CardHeader>
        <CardContent>
          {topProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ventas todavía.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Unidades vendidas</TableHead>
                  <TableHead>Facturación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topProducts.map((p) => (
                  <TableRow key={p.label}>
                    <TableCell className="font-medium">{p.label}</TableCell>
                    <TableCell>{p.unitsSold}</TableCell>
                    <TableCell>{formatCurrency(p.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
