"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { TopProductRow } from "@/lib/reports";

const chartConfig: ChartConfig = {
  unitsSold: { label: "Unidades vendidas", color: "var(--chart-2)" },
};

/**
 * Barras horizontales, agrupado por producto por default — getTopProducts
 * ya colapsa la variante "Único" al nombre del producto; una variante con
 * nombre propio se distingue en la etiqueta ("Producto — Variante"), el
 * detalle de facturación vive en el tooltip.
 */
export function TopProductsChart({ data }: { data: TopProductRow[] }) {
  const rows = [...data].reverse(); // recharts vertical bars render top-to-bottom in array order

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Productos más vendidos</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Sin ventas en este período.</p>
        ) : (
          <ChartContainer config={chartConfig} className="w-full" style={{ height: Math.max(160, rows.length * 32) }}>
            <BarChart data={rows} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis
                dataKey="label"
                type="category"
                tickLine={false}
                axisLine={false}
                width={140}
                fontSize={11}
                tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelKey="label"
                    formatter={(value, name, item) => {
                      if (name !== "unitsSold") return null;
                      const revenue = (item.payload as TopProductRow).revenue;
                      return (
                        <div className="flex flex-col">
                          <span>{value} unidades</span>
                          <span className="text-muted-foreground">
                            {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(revenue)}
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Bar dataKey="unitsSold" fill="var(--color-unitsSold)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
