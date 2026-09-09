"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { formatPeriodLabel } from "@/lib/workshop-dues";
import { generateMonthlyDues } from "./actions";

export function GenerateDuesForm({
  period,
  activeEnrollments,
  duesCount,
}: {
  period: string;
  activeEnrollments: number;
  duesCount: number;
}) {
  const [state, formAction, isPending] = useActionState(generateMonthlyDues, {});

  return (
    <div className="rounded-lg border bg-card p-4">
      <form action={formAction} className="flex flex-wrap items-center justify-between gap-3">
        <input type="hidden" name="period" value={period} />
        <div>
          <p className="font-medium">{formatPeriodLabel(period)}</p>
          <p className="text-sm text-muted-foreground">
            {activeEnrollments} alumnas activas · {duesCount} cuota(s) ya generada(s) este período
          </p>
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Generando..." : "Generar cuotas"}
        </Button>
      </form>
      {state.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
      {state.result && (
        <p className="mt-2 text-sm text-muted-foreground">
          Generadas: <span className="font-medium text-foreground">{state.result.created}</span> · Ya
          existentes: <span className="font-medium text-foreground">{state.result.existing}</span> · Sin
          cuota mensual configurada:{" "}
          <span className="font-medium text-foreground">{state.result.noFee}</span>
        </p>
      )}
    </div>
  );
}
