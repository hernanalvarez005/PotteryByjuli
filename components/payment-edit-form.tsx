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
import { isoToArgentinaDate } from "@/lib/format";

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

export type PaymentActionState = { error?: string };
export type PaymentAction = (prevState: PaymentActionState, formData: FormData) => Promise<PaymentActionState>;

/**
 * Formulario de corrección de un pago. Compartido por la fila inline del
 * detalle de pedido/cuota (payment-edit-row.tsx) y por el diálogo "Corregir"
 * de /pagos y de la ficha del cliente. Corrige el pago EN EL LUGAR: la fecha
 * se muestra en hora Argentina (no el día UTC) y, si no se toca, el servidor
 * no la modifica. "Motivo" es opcional pero recomendado: queda en el
 * historial junto a quién y cuándo.
 */
export function PaymentEditForm({
  payment,
  paymentMethods,
  paymentAccounts,
  action,
  onDone,
  onCancel,
  idPrefix = "edit",
}: {
  payment: EditablePayment;
  paymentMethods: { id: string; name: string }[];
  paymentAccounts: { id: string; name: string }[];
  action: PaymentAction;
  onDone: () => void;
  onCancel: () => void;
  idPrefix?: string;
}) {
  const [state, formAction, isPending] = useActionState(action, {});
  const [methodId, setMethodId] = useState(payment.method_id ?? "");
  const [accountId, setAccountId] = useState(payment.account_id ?? "");
  const methodLabels = Object.fromEntries(paymentMethods.map((m) => [m.id, m.name]));
  const accountLabels = Object.fromEntries(paymentAccounts.map((a) => [a.id, a.name]));

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) onDone();
    wasPending.current = isPending;
  }, [isPending, state.error, onDone]);

  const id = (name: string) => `${idPrefix}-${name}-${payment.id}`;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={id("amount")} className="text-xs text-muted-foreground">
            Importe
          </Label>
          <Input id={id("amount")} name="amount" type="number" min="0.01" step="0.01" defaultValue={payment.amount} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("paid_at")} className="text-xs text-muted-foreground">
            Fecha del pago
          </Label>
          <Input
            id={id("paid_at")}
            name="paid_at"
            type="date"
            defaultValue={isoToArgentinaDate(payment.paid_at)}
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
          <Label htmlFor={id("reference")} className="text-xs text-muted-foreground">
            Referencia
          </Label>
          <Input id={id("reference")} name="reference" defaultValue={payment.reference ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("fee_amount")} className="text-xs text-muted-foreground">
            Comisión
          </Label>
          <Input id={id("fee_amount")} name="fee_amount" type="number" min="0" step="0.01" defaultValue={payment.fee_amount} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id("notes")} className="text-xs text-muted-foreground">
          Notas del pago
        </Label>
        <Input id={id("notes")} name="notes" defaultValue={payment.notes ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={id("reason")} className="text-xs text-muted-foreground">
          Motivo de la corrección (recomendado)
        </Label>
        <Input
          id={id("reason")}
          name="reason"
          maxLength={300}
          placeholder="Ej: importe mal cargado, era $52.200"
        />
      </div>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Guardando..." : "Guardar corrección"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
