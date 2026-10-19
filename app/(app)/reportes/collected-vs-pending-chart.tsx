"use client";

import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { CollectedVsPending } from "@/lib/report-view";
import { usePrivacyMode, maskCurrency } from "@/lib/privacy-mode";

const chartConfig: ChartConfig = {
  collected: { label: "Ya cobrado", color: "var(--chart-1)" },
  pending: { label: "Falta cobrar", color: "var(--chart-2)" },
};

/**
 * De lo FACTURADO en el período, cuánto ya se cobró (a hoy) y cuánto falta. Las dos partes suman
 * exactamente la facturación (el sobrepago se descuenta del cobrado y se avisa aparte).
 */
export function CollectedVsPendingChart({ data }: { data: CollectedVsPending }) {
  const { isPrivate } = usePrivacyMode();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cobrado vs. pendiente</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data.invoiced <= 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Sin facturación en este período.</p>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="h-24 w-full">
              <BarChart data={[{ name: "Facturación", collected: data.collected, pending: data.pending }]} layout="vertical" margin={{ left: 0, right: 0 }}>
                <XAxis type="number" hide domain={[0, data.invoiced]} />
                <YAxis type="category" dataKey="name" hide />
                <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(value) => maskCurrency(Number(value), isPrivate)} />} />
                <Bar dataKey="collected" stackId="a" fill="var(--color-collected)" radius={[6, 0, 0, 6]} />
                <Bar dataKey="pending" stackId="a" fill="var(--color-pending)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ChartContainer>
            <ul className="flex flex-col gap-1.5 text-sm">
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="size-2.5 rounded-sm" style={{ backgroundColor: "var(--chart-1)" }} />
                  Ya cobrado ({data.collectedPct}%)
                </span>
                <span className="font-medium">{maskCurrency(data.collected, isPrivate)}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="size-2.5 rounded-sm" style={{ backgroundColor: "var(--chart-2)" }} />
                  Falta cobrar ({data.pendingPct}%)
                </span>
                <span className="font-medium">{maskCurrency(data.pending, isPrivate)}</span>
              </li>
              <li className="flex items-center justify-between gap-2 border-t pt-1.5">
                <span className="text-muted-foreground">Facturación del período</span>
                <span className="font-medium">{maskCurrency(data.invoiced, isPrivate)}</span>
              </li>
            </ul>
            {data.overpaid > 0 && (
              <p className="text-xs text-muted-foreground">
                Hay {maskCurrency(data.overpaid, isPrivate)} cobrados de más en estos pedidos (sobrepago): no cuentan como
                cobrado ni como pendiente.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
