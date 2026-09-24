"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PaymentEditRow } from "@/components/payment-edit-row";
import { todayInArgentina } from "@/lib/format";
import { addPayment, updatePayment } from "../actions";

export type Payment = {
  id: string;
  amount: number;
  paid_at: string;
  method_id: string | null;
  account_id: string | null;
  reference: string | null;
  notes: string | null;
  fee_amount: number;
  payment_methods: { name: string } | null;
};

export function PaymentsPanel({
  orderId,
  payments,
  methods,
  accounts,
  canEdit,
}: {
  orderId: string;
  payments: Payment[];
  methods: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const boundAction = addPayment.bind(null, orderId);
  const [state, formAction, isPending] = useActionState(boundAction, {});
  const [methodId, setMethodId] = useState("");
  const [accountId, setAccountId] = useState("");
  // Passed as each Select's `items` prop so the trigger can resolve a
  // label for a value that's already selected before the popup has ever
  // registered its <Select.Item>s — without it, Base UI's <Select.Value>
  // falls back to showing the raw id instead of its label.
  const methodLabels = Object.fromEntries(methods.map((m) => [m.id, m.name]));
  const accountLabels = Object.fromEntries(accounts.map((a) => [a.id, a.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pagos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no se registró ningún pago.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {payments.map((p) => (
              <PaymentEditRow
                key={p.id}
                payment={p}
                paymentMethods={methods}
                paymentAccounts={accounts}
                action={updatePayment.bind(null, orderId, p.id)}
                canEdit={canEdit}
              />
            ))}
          </ul>
        )}

        {canEdit && (
          <form action={formAction} className="grid grid-cols-2 gap-3 border-t pt-4">
            <div className="space-y-1">
              <Label htmlFor="amount">Importe</Label>
              <Input id="amount" name="amount" type="number" min="0" step="0.01" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="paid_at">Fecha del pago</Label>
              <Input id="paid_at" name="paid_at" type="date" defaultValue={todayInArgentina()} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="method_id">Método</Label>
              <input type="hidden" name="method_id" value={methodId} />
              <Select items={methodLabels} value={methodId} onValueChange={(v) => setMethodId(v ?? "")}>
                <SelectTrigger id="method_id" className="w-full">
                  <SelectValue placeholder="Elegir" />
                </SelectTrigger>
                <SelectContent>
                  {methods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="account_id">Cuenta</Label>
              <input type="hidden" name="account_id" value={accountId} />
              <Select items={accountLabels} value={accountId} onValueChange={(v) => setAccountId(v ?? "")}>
                <SelectTrigger id="account_id" className="w-full">
                  <SelectValue placeholder="Elegir" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reference">Referencia</Label>
              <Input id="reference" name="reference" />
            </div>
            {state.error && (
              <p className="col-span-2 text-sm text-destructive">{state.error}</p>
            )}
            <Button type="submit" disabled={isPending} className="col-span-2 self-start">
              {isPending ? "Guardando..." : "Registrar pago"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
