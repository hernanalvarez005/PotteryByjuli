"use client";

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { SalesOverTimePoint } from "@/lib/reports";
import { bucketLabel } from "@/lib/report-view";
import { usePrivacyMode, maskCurrency } from "@/lib/privacy-mode";

const chartConfig: ChartConfig = {
  total: { label: "Facturación", color: "var(--chart-1)" },
  collected: { label: "Cobrado", color: "var(--chart-2)" }, // clay: se distingue de las barras (sage)
};

/**
 * Facturación (barras, por fecha de venta) y cobrado (línea, por fecha de pago) en el tiempo. Son dos
 * preguntas distintas — qué vendí vs. qué entró —, por eso el cobrado puede superar a la facturación
 * de un bucket. Σ barras == KPI de facturación y Σ línea == KPI de cobrado (definiciones oficiales).
 */
export function SalesTimeChart({ data }: { data: SalesOverTimePoint[] }) {
  const { isPrivate } = usePrivacyMode();
  const hasData = data.some((d) => d.total > 0 || d.collected > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Facturación y cobrado en el tiempo</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Sin movimientos en este período.</p>
        ) : (
          <ChartContainer config={chartConfig} className="h-72 w-full">
            <ComposedChart data={data.map((d) => ({ ...d, label: bucketLabel(d.bucket) }))}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={11} width={56} />
              <ChartTooltip content={<ChartTooltipContent labelKey="label" formatter={(value) => maskCurrency(Number(value), isPrivate)} />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="total" fill="var(--color-total)" radius={4} />
              <Line dataKey="collected" type="linear" stroke="var(--color-collected)" strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
