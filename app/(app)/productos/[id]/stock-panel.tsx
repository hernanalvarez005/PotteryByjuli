import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ProductStockSummary } from "@/lib/inventory";
import { AdjustmentDialog } from "../../stock/adjustment-dialog";

function stockStatus(available: number, min: number | null) {
  if (available <= 0) return { label: "Sin stock", variant: "destructive" as const };
  if (min != null && available <= min) return { label: "Bajo", variant: "outline" as const };
  return { label: "Normal", variant: "secondary" as const };
}

/**
 * Stock por ubicación, dentro de la ficha del producto (Bloque 5 —
 * consolidación Productos/Precios/Stock). No es una vista nueva de
 * stock: reusa exactamente los mismos datos y el mismo diálogo de
 * ajuste que /stock — sólo evita saltar de pantalla para ver el cuadro
 * completo de un producto. /stock y /precios como vistas globales/bulk
 * siguen intactas.
 */
export function StockPanel({
  variants,
  summaries,
  canEdit,
}: {
  variants: { id: string; name: string; is_active: boolean }[];
  summaries: Record<string, ProductStockSummary | undefined>;
  canEdit: boolean;
}) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">Stock por ubicación</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin variantes.</p>
        ) : (
          variants.map((variant) => {
            const summary = summaries[variant.id];
            const status = stockStatus(summary?.totalAvailable ?? 0, null);

            return (
              <div key={variant.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{variant.name}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <span className="text-sm text-muted-foreground">
                      Total disponible:{" "}
                      <span className="font-medium text-foreground">{summary?.totalAvailable ?? 0}</span>
                    </span>
                  </div>
                </div>
                {!variant.is_active ? (
                  <p className="mt-2 border-t pt-2 text-sm text-muted-foreground">
                    Variante inactiva — no se le sigue stock.
                  </p>
                ) : !summary || summary.byLocation.length === 0 ? (
                  <p className="mt-2 border-t pt-2 text-sm text-muted-foreground">
                    Sin ubicaciones activas.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-col gap-1 border-t pt-2">
                    {summary.byLocation.map((loc) => (
                      <div key={loc.locationId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">{loc.locationName}</span>
                        <div className="flex items-center gap-3">
                          <span>
                            Físico {loc.physical} · Reservado {loc.reserved} · Disponible {loc.available}
                          </span>
                          {canEdit && (
                            <AdjustmentDialog
                              inventoryItemId={summary.inventoryItemId}
                              locationId={loc.locationId}
                              productLabel={variant.name}
                              locationName={loc.locationName}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
