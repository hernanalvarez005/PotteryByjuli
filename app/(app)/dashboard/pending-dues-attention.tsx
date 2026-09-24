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
  totalCount,
  paymentMethods,
  paymentAccounts,
  canEdit,
}: {
  dues: PendingDueRow[];
  /** Cuenta real de `workshop_due_balances` (perf audit P1) — nunca
   * `dues.length`, que ahora está topeado a las 50 más antiguas
   * (`getDashboardSummary`). Es cantidad de CUOTAS pendientes, nunca
   * "alumnas deudoras": la misma alumna puede tener varias. */
  totalCount: number;
  paymentMethods: { id: string; name: string }[];
  paymentAccounts: { id: string; name: string }[];
  /** A diferencia de DuesPanel/period-dues-summary (que sólo renderizan
   * RegisterPaymentDialog detrás de su propio canEdit), esta card
   * aparece para cualquier rol con `summary` — incluida "Solo lectura".
   * Sin este prop, viewer/workshop_staff veían "Editar" y el submit
   * fallaba recién en el servidor (assertCanManageDues lanza, no
   * devuelve un {error} prolijo) — gap real de permisos en la UI. */
  canEdit: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isTruncated = totalCount > dues.length;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left hover:underline"
        onClick={() => setExpanded((v) => !v)}
      >
        <span>
          <span>
            {totalCount} cuota{totalCount !== 1 ? "s" : ""} de taller{totalCount !== 1 ? "es" : ""} pendiente
            {totalCount !== 1 ? "s" : ""}
          </span>
          {isTruncated && (
            <span className="block text-xs font-normal text-muted-foreground">
              Mostrando las {dues.length} más antiguas
            </span>
          )}
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
                canEdit={canEdit}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
