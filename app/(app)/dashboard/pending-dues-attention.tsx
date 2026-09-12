"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { RegisterPaymentDialog } from "@/app/(app)/talleres/[groupId]/dues-panel";
import type { PendingDueRow } from "@/lib/reports";

/**
 * "Necesita atención → Cuotas pendientes" accionable desde Inicio
 * (sección 12/13 de la tanda de usabilidad) — desplegable, muestra
 * Alumna/Grupo/Período/Total/Pagado/Pendiente y permite "Registrar
 * pago" sin navegar a Talleres. Reusa RegisterPaymentDialog tal cual
 * (mismo componente que /talleres/[groupId] y /talleres/cuotas) — nunca
 * un segundo camino financiero para lo mismo.
 */
export function PendingDuesAttention({
  dues,
  paymentMethods,
  paymentAccounts,
}: {
  dues: PendingDueRow[];
  paymentMethods: { id: string; name: string }[];
  paymentAccounts: { id: string; name: string }[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left hover:underline"
        onClick={() => setExpanded((v) => !v)}
      >
        <span>
          {dues.length} cuota{dues.length !== 1 ? "s" : ""} de taller{dues.length !== 1 ? "es" : ""} pendiente
          {dues.length !== 1 ? "s" : ""}
        </span>
        {expanded ? <ChevronUp className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
      </button>

      {expanded && (
        <ul className="flex flex-col gap-2 border-l pl-3">
          {dues.map((due) => (
            <li key={due.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <span className="font-medium">{due.customerName}</span>{" "}
                <span className="text-muted-foreground">
                  · {due.groupName} · {due.period}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Total {formatCurrency(due.totalDue)} · Pagado {formatCurrency(due.paidTotal)} · Pendiente{" "}
                  {formatCurrency(due.balance)}
                </span>
              </span>
              <RegisterPaymentDialog
                groupId={due.groupId}
                dueId={due.id}
                customerName={due.customerName}
                balance={due.balance}
                paymentMethods={paymentMethods}
                paymentAccounts={paymentAccounts}
                payments={due.payments}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
