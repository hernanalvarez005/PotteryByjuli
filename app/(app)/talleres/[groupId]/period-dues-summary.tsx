"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import {
  classifyForPeriod,
  currentPeriod,
  formatPeriodLabel,
  previousPeriod,
  nextPeriod,
  type EnrollmentForPeriod,
  type PeriodStatus,
} from "@/lib/workshop-dues";
import { createDue } from "./actions";
import { RegisterPaymentDialog, type DuePaymentRow } from "./dues-panel";

export type EnrollmentSummaryInput = EnrollmentForPeriod & { customerName: string };

export type DueForSummary = {
  id: string;
  enrollmentId: string;
  period: string;
  status: "pending" | "partial" | "paid" | "cancelled";
  balance: number;
  payments: DuePaymentRow[];
};

/**
 * Resumen pagas/deudoras por período (Bloque 1 — Talleres, auditoría
 * "Ventas: fecha real, canal, comisiones y talleres"). Pura reagregación
 * client-side de datos que la página ya trajo — sin due, sólo cuenta
 * como deudora si classifyForPeriod la considera genuinamente elegible
 * (activa, con tarifa, ya de alta para el período), nunca sólo por tener
 * una tarifa configurada.
 */
export function PeriodDuesSummary({
  groupId,
  enrollments,
  dues,
  paymentMethods,
  paymentAccounts,
  canEdit,
}: {
  groupId: string;
  enrollments: EnrollmentSummaryInput[];
  dues: DueForSummary[];
  paymentMethods: { id: string; name: string }[];
  paymentAccounts: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [period, setPeriod] = useState(() => currentPeriod());
  const [expanded, setExpanded] = useState<PeriodStatus | null>(null);

  const dueByEnrollment = useMemo(() => {
    const map = new Map<string, DueForSummary>();
    for (const due of dues) {
      if (due.period === period) map.set(due.enrollmentId, due);
    }
    return map;
  }, [dues, period]);

  const classified = useMemo(() => {
    const buckets: Record<PeriodStatus, { enrollment: EnrollmentSummaryInput; due: DueForSummary | null }[]> = {
      paid: [],
      debtor: [],
      excluded: [],
    };
    for (const enrollment of enrollments) {
      const due = dueByEnrollment.get(enrollment.id) ?? null;
      const status = classifyForPeriod(enrollment, period, due);
      buckets[status].push({ enrollment, due });
    }
    return buckets;
  }, [enrollments, dueByEnrollment, period]);

  const totalCounted = classified.paid.length + classified.debtor.length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="size-7" onClick={() => setPeriod((p) => previousPeriod(p))}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <CardTitle className="text-base">{formatPeriodLabel(period)}</CardTitle>
          <Button size="icon" variant="outline" className="size-7" onClick={() => setPeriod((p) => nextPeriod(p))}>
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
        <span className="text-sm text-muted-foreground">{totalCounted} alumnas</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setExpanded(expanded === "paid" ? null : "paid")}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              expanded === "paid" ? "border-primary bg-accent" : "border-input hover:bg-accent/50"
            }`}
          >
            ✓ {classified.paid.length} pagas
          </button>
          <button
            type="button"
            onClick={() => setExpanded(expanded === "debtor" ? null : "debtor")}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              expanded === "debtor" ? "border-primary bg-accent" : "border-input hover:bg-accent/50"
            }`}
          >
            ! {classified.debtor.length} deudoras
          </button>
        </div>

        {expanded && (
          <div className="flex flex-col gap-1.5 border-t pt-3">
            {classified[expanded].length === 0 ? (
              <p className="text-sm text-muted-foreground">Nadie en esta lista.</p>
            ) : (
              classified[expanded].map(({ enrollment, due }) => (
                <div key={enrollment.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{enrollment.customerName}</span>
                  <div className="flex items-center gap-2">
                    {due ? (
                      <>
                        {expanded === "debtor" && due.balance > 0 && (
                          <span className="text-xs text-muted-foreground">{formatCurrency(due.balance)}</span>
                        )}
                        {due.status !== "pending" && due.status !== "partial" && (
                          <Badge variant="secondary" className="text-[10px]">
                            {due.status === "paid" ? "Pagada" : "Cancelada"}
                          </Badge>
                        )}
                        {canEdit && (
                          <RegisterPaymentDialog
                            groupId={groupId}
                            dueId={due.id}
                            customerName={enrollment.customerName}
                            balance={due.balance}
                            paymentMethods={paymentMethods}
                            paymentAccounts={paymentAccounts}
                            payments={due.payments}
                            allowNewPayment={due.status === "pending" || due.status === "partial"}
                          />
                        )}
                      </>
                    ) : (
                      <>
                        {enrollment.monthlyFee != null && (
                          <span className="text-xs text-muted-foreground">{formatCurrency(enrollment.monthlyFee)}</span>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          Sin cuota generada
                        </Badge>
                        {canEdit && (
                          <GenerateDueDialog
                            groupId={groupId}
                            enrollmentId={enrollment.id}
                            customerName={enrollment.customerName}
                            period={period}
                            defaultAmount={enrollment.monthlyFee}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Generar la cuota de una alumna puntual para el período, antes de poder
 * registrarle un pago — mismo createDue de siempre (./actions), sólo
 * pre-cargado con la alumna/período/tarifa ya resueltos, para no
 * mandarla a buscarlos a mano en "Cuota individual". */
function GenerateDueDialog({
  groupId,
  enrollmentId,
  customerName,
  period,
  defaultAmount,
}: {
  groupId: string;
  enrollmentId: string;
  customerName: string;
  period: string;
  defaultAmount: number | null;
}) {
  const [open, setOpen] = useState(false);
  const boundAction = createDue.bind(null, groupId, enrollmentId);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        <Plus className="size-3.5" />
        Generar cuota
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generar cuota — {customerName}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="period" value={period} />
          <div className="space-y-2">
            <Label htmlFor="generate_due_amount">Importe ({formatPeriodLabel(period)})</Label>
            <Input
              id="generate_due_amount"
              name="amount"
              type="number"
              min="0"
              step="0.01"
              defaultValue={defaultAmount ?? undefined}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="generate_due_date">Vencimiento (opcional)</Label>
            <Input id="generate_due_date" name="due_date" type="date" />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Generando..." : "Generar cuota"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
