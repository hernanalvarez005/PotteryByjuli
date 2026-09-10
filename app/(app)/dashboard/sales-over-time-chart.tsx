"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { SalesOverTimePoint } from "@/lib/reports";

const chartConfig: ChartConfig = {
  total: { label: "Ventas", color: "var(--chart-1)" },
};

function labelForBucket(bucket: string): string {
  // "2026-09" (mensual) o "2026-09-04" (diario)
  const [year, month, day] = bucket.split("-");
  return day ? `${day}/${month}` : `${month}/${year.slice(2)}`;
}

export function SalesOverTimeChart({ data }: { data: SalesOverTimePoint[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ventas en el tiempo</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Sin ventas en este período.</p>
        ) : (
          <ChartContainer config={chartConfig} className="h-64 w-full">
            <BarChart data={data.map((d) => ({ ...d, label: labelForBucket(d.bucket) }))}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={11} width={50} />
              <ChartTooltip content={<ChartTooltipContent labelKey="label" />} />
              <Bar dataKey="total" fill="var(--color-total)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
