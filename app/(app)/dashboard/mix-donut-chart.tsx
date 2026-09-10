"use client";

import { useState } from "react";
import { Pie, PieChart, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCurrency } from "@/lib/format";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

type MixRow = { name: string; total: number };

/**
 * Donut, sólo para composición — nunca la única vista de una serie
 * temporal (SalesOverTimeChart la cubre). Un toggle entre unidad de
 * negocio/canal en vez de dos donuts separados, mismo dato de origen ya
 * resuelto server-side en las dos props.
 */
export function MixDonutChart({ byUnit, byChannel }: { byUnit: MixRow[]; byChannel: MixRow[] }) {
  const [mode, setMode] = useState<"unit" | "channel">("unit");
  const data = mode === "unit" ? byUnit : byChannel;
  const config: ChartConfig = Object.fromEntries(
    data.map((row, i) => [row.name, { label: row.name, color: COLORS[i % COLORS.length] }])
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Mix de ventas</CardTitle>
        <div className="flex gap-1">
          <Button size="sm" variant={mode === "unit" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setMode("unit")}>
            Unidad
          </Button>
          <Button size="sm" variant={mode === "channel" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setMode("channel")}>
            Canal
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Sin ventas en este período.</p>
        ) : (
          <ChartContainer config={config} className="mx-auto aspect-square h-64">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value))} hideLabel />} />
              <Pie data={data} dataKey="total" nameKey="name" innerRadius={55} outerRadius={90} strokeWidth={2}>
                {data.map((row, i) => (
                  <Cell key={row.name} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        )}
        {data.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {data.map((row, i) => (
              <li key={row.name} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  {row.name}
                </span>
                <span className="font-medium">{formatCurrency(row.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
