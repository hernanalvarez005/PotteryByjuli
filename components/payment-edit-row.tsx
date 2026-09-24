"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/format";

export type EditablePayment = {
  id: string;
  amount: number;
  paid_at: string;
  method_id: string | null;
  account_id: string | null;
  reference: string | null;
  notes: string | null;
  fee_amount: number;
};

type PaymentActionState = { error?: string };

/**
 * Una fila de pago ya cargado, con un botón "Editar" que revela un
 * formulario corto para corregirlo en el lugar — nunca anular/recargar.
 * Compartido entre pedidos/ventas (payments-panel.tsx) y talleres
 * (dues-panel.tsx): mismos campos, mismo patrón, sólo cambia a qué
 * Server Action se liga (cada uno scopea el UPDATE a su propio padre —
 * order_id o workshop_due_id — el componente no lo sabe ni le importa).
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
  action: (prevState: PaymentActionState, formData: FormData) => Promise<PaymentActionState>;
  /** Sólo perfiles autorizados (owner/operations) pueden corregir un
   * pago — mismo chequeo que ya hace el Server Action y la RLS de
   * `payments`, acá sólo para no mostrar un botón que el servidor va a
   * rechazar. */
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, isPending] = useActionState(action, {});
  const [methodId, setMethodId] = useState(payment.method_id ?? "");
  const [accountId, setAccountId] = useState(payment.account_id ?? "");
  const methodLabels = Object.fromEntries(paymentMethods.map((m) => [m.id, m.name]));
  const accountLabels = Object.fromEntries(paymentAccounts.map((a) => [a.id, a.name]));
  const methodName = payment.method_id
    ? (paymentMethods.find((m) => m.id === payment.method_id)?.name ?? null)
    : null;

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) setEditing(false);
    wasPending.current = isPending;
  }, [isPending, state.error]);

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-3 text-sm">
        <span>
          {formatCurrency(payment.amount)}
          {methodName && <span className="text-muted-foreground"> · {methodName}</span>}
          {payment.reference && <span className="text-muted-foreground"> · {payment.reference}</span>}
          {payment.fee_amount > 0 && (
            <span className="text-muted-foreground"> · comisión {formatCurrency(payment.fee_amount)}</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{formatDate(payment.paid_at)}</span>
          {canEdit && (
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(true)}>
              Editar
            </Button>
          )}
        </span>
      </li>
    );
  }

  return (
    <li className="rounded-md border p-3">
      <form action={formAction} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor={`edit-amount-${payment.id}`} className="text-xs text-muted-foreground">
              Importe
            </Label>
            <Input
              id={`edit-amount-${payment.id}`}
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              defaultValue={payment.amount}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`edit-paid_at-${payment.id}`} className="text-xs text-muted-foreground">
              Fecha del pago
            </Label>
            <Input
              id={`edit-paid_at-${payment.id}`}
              name="paid_at"
              type="date"
              defaultValue={payment.paid_at.slice(0, 10)}
              required
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Medio de pago</Label>
            <input type="hidden" name="method_id" value={methodId} />
            <Select items={methodLabels} value={methodId} onValueChange={(v) => setMethodId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elegir (opcional)" />
              </SelectTrigger>
              <SelectContent>
                {paymentMethods.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Cuenta</Label>
            <input type="hidden" name="account_id" value={accountId} />
            <Select items={accountLabels} value={accountId} onValueChange={(v) => setAccountId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elegir (opcional)" />
              </SelectTrigger>
              <SelectContent>
                {paymentAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor={`edit-reference-${payment.id}`} className="text-xs text-muted-foreground">
              Referencia
            </Label>
            <Input id={`edit-reference-${payment.id}`} name="reference" defaultValue={payment.reference ?? ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`edit-fee_amount-${payment.id}`} className="text-xs text-muted-foreground">
              Comisión
            </Label>
            <Input
              id={`edit-fee_amount-${payment.id}`}
              name="fee_amount"
              type="number"
              min="0"
              step="0.01"
              defaultValue={payment.fee_amount}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`edit-notes-${payment.id}`} className="text-xs text-muted-foreground">
            Nota de la corrección
          </Label>
          <Input
            id={`edit-notes-${payment.id}`}
            name="notes"
            placeholder="Ej: importe mal cargado, era $12.000"
            defaultValue={payment.notes ?? ""}
          />
        </div>
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Guardando..." : "Guardar"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    </li>
  );
}
