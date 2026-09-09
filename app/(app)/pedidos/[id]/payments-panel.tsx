"use client";

import { useActionState } from "react";
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
import { formatCurrency, formatDateTime } from "@/lib/format";
import { addPayment } from "../actions";

export type Payment = {
  id: string;
  amount: number;
  paid_at: string;
  reference: string | null;
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
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span>
                  {formatCurrency(p.amount)}
                  {p.payment_methods && (
                    <span className="text-muted-foreground"> · {p.payment_methods.name}</span>
                  )}
                  {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(p.paid_at)}</span>
              </li>
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
              <Label htmlFor="method_id">Método</Label>
              <Select name="method_id">
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
              <Select name="account_id">
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
