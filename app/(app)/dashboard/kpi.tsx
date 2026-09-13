"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePrivacyMode, maskCurrency } from "@/lib/privacy-mode";

export function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-xl font-semibold">{value}</CardContent>
    </Card>
  );
}

/** Un KPI que es un importe — se enmascara con el modo privado (Bloque
 * 8), a diferencia de un conteo (ej. "Pedidos activos"), que usa `Kpi`
 * tal cual y nunca se oculta. */
export function KpiCurrency({ label, amount }: { label: string; amount: number }) {
  const { isPrivate } = usePrivacyMode();
  return <Kpi label={label} value={maskCurrency(amount, isPrivate)} />;
}
