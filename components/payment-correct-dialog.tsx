"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PaymentEditForm, type EditablePayment } from "@/components/payment-edit-form";
import { PaymentHistory } from "@/components/payment-history";
import { formatCurrency } from "@/lib/format";
import { correctPayment } from "@/app/(app)/pagos/actions";

/**
 * "Corregir" un pago desde una lista (/pagos, ficha del cliente). Abre un
 * diálogo con el mismo formulario del detalle del pedido y, debajo, el
 * historial de correcciones. El servidor resuelve a qué pedido o cuota
 * pertenece el pago.
 */
export function PaymentCorrectDialog({
  payment,
  originLabel,
  paymentMethods,
  paymentAccounts,
  canEdit,
}: {
  payment: EditablePayment;
  originLabel: string;
  paymentMethods: { id: string; name: string }[];
  paymentAccounts: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" className="h-7" />}>
        {canEdit ? "Corregir" : "Historial"}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {canEdit ? "Corregir pago" : "Historial del pago"} · {formatCurrency(payment.amount)}
          </DialogTitle>
          <DialogDescription>
            {originLabel}. El pago se corrige en el lugar: el saldo y los reportes se recalculan solos y la corrección
            queda en el historial.
          </DialogDescription>
        </DialogHeader>
        {/* Se monta sólo con el diálogo abierto: cada apertura arranca de los valores guardados
            (nunca arrastra lo tipeado en una apertura anterior ni un defaultValue desactualizado). */}
        {open && canEdit && (
          <PaymentEditForm
            idPrefix="dlg"
            payment={payment}
            paymentMethods={paymentMethods}
            paymentAccounts={paymentAccounts}
            action={correctPayment.bind(null, payment.id)}
            onDone={close}
            onCancel={close}
          />
        )}
        <section className="flex flex-col gap-2 border-t pt-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Historial de correcciones</h3>
          {open && <PaymentHistory paymentId={payment.id} />}
        </section>
      </DialogContent>
    </Dialog>
  );
}
