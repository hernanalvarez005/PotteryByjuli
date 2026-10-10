"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  PaymentEditForm,
  type EditablePayment,
  type PaymentAction,
} from "@/components/payment-edit-form";
import { PaymentHistory } from "@/components/payment-history";

export type { EditablePayment };

/**
 * Una fila de pago ya cargado, con un botón "Corregir" que revela el
 * formulario para corregirlo en el lugar — nunca anular/recargar — y un
 * "Historial" con las correcciones anteriores. Compartido entre
 * pedidos/ventas (payments-panel.tsx) y talleres (dues-panel.tsx): mismos
 * campos, mismo patrón, sólo cambia a qué Server Action se liga (cada uno
 * scopea la corrección a su propio padre — order_id o workshop_due_id).
 */
export function PaymentEditRow({
  payment,
  paymentMethods,
  paymentAccounts,
  action,
  canEdit,
}: {
  payment: EditablePayment;
  paymentMethods: { id: string; name: string }[];
  paymentAccounts: { id: string; name: string }[];
  action: PaymentAction;
  /** Sólo perfiles autorizados (owner/operations) pueden corregir un
   * pago — mismo chequeo que ya hace el Server Action y la RLS de
   * `payments`, acá sólo para no mostrar un botón que el servidor va a
   * rechazar. */
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const close = useCallback(() => setEditing(false), []);
  const methodName = payment.method_id
    ? (paymentMethods.find((m) => m.id === payment.method_id)?.name ?? null)
    : null;

  if (editing) {
    return (
      <li className="rounded-md border p-3">
        <PaymentEditForm
          payment={payment}
          paymentMethods={paymentMethods}
          paymentAccounts={paymentAccounts}
          action={action}
          onDone={close}
          onCancel={close}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span>
          {formatCurrency(payment.amount)}
          {methodName && <span className="text-muted-foreground"> · {methodName}</span>}
          {payment.reference && <span className="text-muted-foreground"> · {payment.reference}</span>}
          {payment.fee_amount > 0 && (
            <span className="text-muted-foreground"> · comisión {formatCurrency(payment.fee_amount)}</span>
          )}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{formatDate(payment.paid_at)}</span>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Ocultar historial" : "Historial"}
          </Button>
          {canEdit && (
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(true)}>
              Corregir
            </Button>
          )}
        </span>
      </div>
      {showHistory && <PaymentHistory paymentId={payment.id} />}
    </li>
  );
}
