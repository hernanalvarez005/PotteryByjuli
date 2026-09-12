"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ConfirmAction } from "@/components/confirm-action";
import { Plus, Receipt } from "lucide-react";
import { formatCurrency, formatDate, todayInArgentina } from "@/lib/format";
import { DUE_STATUS_LABELS, type DueDisplayStatus } from "@/lib/workshop-dues";
import { createDue, registerDuePayment, updateDuePayment, cancelDue, addDueExtra, voidDueExtra } from "./actions";

export type DueExtraRow = {
  id: string;
  conceptName: string;
  amount: number;
  note: string | null;
  voided: boolean;
};

export type DuePaymentRow = {
  id: string;
  amount: number;
  paid_at: string;
  method_id: string | null;
  account_id: string | null;
  reference: string | null;
  notes: string | null;
};

export type DueRow = {
  id: string;
  enrollmentId: string;
  customerName: string;
  period: string;
  /** Sólo la cuota mensual, sin extras — snapshot histórico. */
  baseAmount: number;
  /** Suma de los cargos extra no anulados. */
  extrasTotal: number;
  /** baseAmount + extrasTotal — lo que realmente se debe. */
  amount: number;
  due_date: string | null;
  paidAmount: number;
  balance: number;
  displayStatus: DueDisplayStatus;
  extras: DueExtraRow[];
  payments: DuePaymentRow[];
};

const STATUS_BADGE_VARIANT: Record<DueDisplayStatus, "secondary" | "outline" | "destructive"> = {
  paid: "secondary",
  partial: "outline",
  pending: "outline",
  cancelled: "destructive",
};

export function DuesPanel({
  groupId,
  dues,
  enrollments,
  paymentMethods,
  paymentAccounts,
  concepts,
  canEdit,
}: {
  groupId: string;
  dues: DueRow[];
  enrollments: { id: string; customerName: string }[];
  paymentMethods: { id: string; name: string }[];
  paymentAccounts: { id: string; name: string }[];
  concepts: { id: string; name: string }[];
  canEdit: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {canEdit && <NewDueDialog groupId={groupId} enrollments={enrollments} />}

      {dues.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay cuotas cargadas. Se generan desde{" "}
          <Link href="/talleres/cuotas" className="underline underline-offset-2">
            Talleres → Cuotas
          </Link>{" "}
          o una por una acá.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Alumno/a</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Importe</TableHead>
              <TableHead>Pagado</TableHead>
              <TableHead>Saldo</TableHead>
              <TableHead>Vencimiento</TableHead>
              <TableHead>Estado</TableHead>
              {canEdit && <TableHead className="text-right">Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {dues.map((due) => (
              <TableRow key={due.id}>
                <TableCell>{due.customerName}</TableCell>
                <TableCell>{due.period}</TableCell>
                <TableCell>
                  {formatCurrency(due.amount)}
                  {due.extrasTotal > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      incl. {formatCurrency(due.extrasTotal)} en extras
                    </span>
                  )}
                </TableCell>
                <TableCell>{formatCurrency(due.paidAmount)}</TableCell>
                <TableCell>{formatCurrency(due.balance)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {due.due_date ? formatDate(due.due_date) : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGE_VARIANT[due.displayStatus]}>
                    {DUE_STATUS_LABELS[due.displayStatus]}
                  </Badge>
                </TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {due.displayStatus !== "cancelled" && (
                        <DueExtrasDialog
                          groupId={groupId}
                          dueId={due.id}
                          customerName={due.customerName}
                          extras={due.extras}
                          concepts={concepts}
                        />
                      )}
                      {(due.payments.length > 0 ||
                        (due.displayStatus !== "paid" && due.displayStatus !== "cancelled")) && (
                        <RegisterPaymentDialog
                          groupId={groupId}
                          dueId={due.id}
                          customerName={due.customerName}
                          balance={due.balance}
                          paymentMethods={paymentMethods}
                          paymentAccounts={paymentAccounts}
                          payments={due.payments}
                          allowNewPayment={due.displayStatus !== "paid" && due.displayStatus !== "cancelled"}
                        />
                      )}
                      {due.displayStatus === "pending" && (
                        <ConfirmAction
                          trigger={<Button size="sm" variant="ghost" />}
                          title="¿Cancelar esta cuota?"
                          description="La cuota deja de estar pendiente de cobro. No se puede deshacer."
                          confirmLabel="Cancelar cuota"
                          onConfirm={() => cancelDue(groupId, due.id)}
                        >
                          Cancelar
                        </ConfirmAction>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function NewDueDialog({
  groupId,
  enrollments,
}: {
  groupId: string;
  enrollments: { id: string; customerName: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [enrollmentId, setEnrollmentId] = useState("");
  const boundAction = createDue.bind(null, groupId, enrollmentId);
  const [state, formAction, isPending] = useActionState(boundAction, {});
  // Passed as Select's `items` prop so the trigger can resolve a label
  // for the selected enrollment — without it, Base UI's <Select.Value>
  // falls back to showing the raw id instead of the student's name.
  const enrollmentLabels = Object.fromEntries(enrollments.map((e) => [e.id, e.customerName]));

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" className="self-start" />}>
        <Plus className="size-4" />
        Cuota individual
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva cuota</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="enrollment">Alumno/a</Label>
            <Select items={enrollmentLabels} value={enrollmentId} onValueChange={(v) => v && setEnrollmentId(v)}>
              <SelectTrigger id="enrollment" className="w-full">
                <SelectValue placeholder="Elegir alumno/a" />
              </SelectTrigger>
              <SelectContent>
                {enrollments.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.customerName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="period">Período (AAAA-MM)</Label>
              <Input id="period" name="period" placeholder="2026-09" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Importe</Label>
              <Input id="amount" name="amount" type="number" min="0" step="0.01" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="due_date">Vencimiento (opcional)</Label>
            <Input id="due_date" name="due_date" type="date" />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending || !enrollmentId}>
              {isPending ? "Creando..." : "Crear cuota"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RegisterPaymentDialog({
  groupId,
  dueId,
  customerName,
  balance,
  paymentMethods,
  paymentAccounts,
  payments,
  allowNewPayment = true,
}: {
  groupId: string;
  dueId: string;
  customerName: string;
  balance: number;
  paymentMethods: { id: string; name: string }[];
  paymentAccounts: { id: string; name: string }[];
  payments: DuePaymentRow[];
  /** false para una cuota ya "Pagada"/"Cancelada" — el diálogo sigue
   * abriéndose para ver/corregir pagos existentes, pero no ofrece
   * cargar uno nuevo. */
  allowNewPayment?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boundAction = registerDuePayment.bind(null, groupId, dueId);
  const [state, formAction, isPending] = useActionState(boundAction, {});
  const [methodId, setMethodId] = useState("");
  const [accountId, setAccountId] = useState("");
  // Passed as Select's `items` prop so the trigger can resolve a label
  // for the selected method — without it, Base UI's <Select.Value> falls
  // back to showing the raw id instead of the method's name.
  const methodLabels = Object.fromEntries(paymentMethods.map((m) => [m.id, m.name]));
  const accountLabels = Object.fromEntries(paymentAccounts.map((a) => [a.id, a.name]));

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        {allowNewPayment ? "Registrar pago" : "Ver pagos"}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pagos — {customerName}</DialogTitle>
        </DialogHeader>

        {payments.length > 0 && (
          <ul className="flex flex-col gap-2 border-b pb-4">
            {payments.map((p) => (
              <PaymentRow
                key={p.id}
                groupId={groupId}
                dueId={dueId}
                payment={p}
                paymentMethods={paymentMethods}
                paymentAccounts={paymentAccounts}
              />
            ))}
          </ul>
        )}

        {allowNewPayment && (
        <form action={formAction} className="flex flex-col gap-4">
          <p className="text-sm font-medium">Registrar pago nuevo</p>
          <div className="space-y-2">
            <Label htmlFor="amount">Importe (saldo: {formatCurrency(balance)})</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              defaultValue={balance}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="paid_at">Fecha del pago</Label>
            <Input id="paid_at" name="paid_at" type="date" defaultValue={todayInArgentina()} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="method_id">Medio de pago</Label>
              <input type="hidden" name="method_id" value={methodId} />
              <Select items={methodLabels} value={methodId} onValueChange={(v) => setMethodId(v ?? "")}>
                <SelectTrigger id="method_id" className="w-full">
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
            <div className="space-y-2">
              <Label htmlFor="account_id">Cuenta</Label>
              <input type="hidden" name="account_id" value={accountId} />
              <Select items={accountLabels} value={accountId} onValueChange={(v) => setAccountId(v ?? "")}>
                <SelectTrigger id="account_id" className="w-full">
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
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando..." : "Registrar pago"}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Un pago ya cargado, con un botón "Editar" que revela un formulario
 * corto (importe/fecha/medio/referencia) para corregirlo en el lugar —
 * a diferencia de los cargos extra (workshop_due_items, append-only a
 * propósito), `payments` sí admite corregirse directamente: un pago mal
 * cargado no necesita anularse y recargarse.
 */
function PaymentRow({
  groupId,
  dueId,
  payment,
  paymentMethods,
  paymentAccounts,
}: {
  groupId: string;
  dueId: string;
  payment: DuePaymentRow;
  paymentMethods: { id: string; name: string }[];
  paymentAccounts: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const boundAction = updateDuePayment.bind(null, groupId, dueId, payment.id);
  const [state, formAction, isPending] = useActionState(boundAction, {});
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
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{formatDate(payment.paid_at)}</span>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(true)}>
            Editar
          </Button>
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
        <div className="space-y-1">
          <Label htmlFor={`edit-reference-${payment.id}`} className="text-xs text-muted-foreground">
            Referencia
          </Label>
          <Input id={`edit-reference-${payment.id}`} name="reference" defaultValue={payment.reference ?? ""} />
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

/**
 * Agregar/anular cargos extra de una cuota — sección 6. Dos acciones
 * distintas (agregar vs. anular), nunca un extra insertado como payment.
 * Anular no borra la fila (docs/business-rules § Cuotas mensuales de
 * talleres): la RPC void_due_item es la única escritura posible después
 * del insert original.
 */
function DueExtrasDialog({
  groupId,
  dueId,
  customerName,
  extras,
  concepts,
}: {
  groupId: string;
  dueId: string;
  customerName: string;
  extras: DueExtraRow[];
  concepts: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [conceptId, setConceptId] = useState("");
  const boundAction = addDueExtra.bind(null, groupId, dueId);
  const [state, formAction, isPending] = useActionState(boundAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  // Passed as Select's `items` prop so the trigger can resolve a label
  // for a value it selects programmatically (here: resetting back to "")
  // — without it, Base UI's <Select.Value> can't do that until the popup
  // has registered its <Select.Item>s, same root cause already fixed in
  // bulk-price-bar.tsx and the /mayorista product-card.tsx.
  const conceptLabelsById = Object.fromEntries(concepts.map((c) => [c.id, c.name]));

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) {
      formRef.current?.reset();
      setConceptId("");
    }
    wasPending.current = isPending;
  }, [isPending, state.error]);

  const activeExtras = extras.filter((e) => !e.voided);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        <Receipt className="size-4" />
        Extras{activeExtras.length > 0 ? ` (${activeExtras.length})` : ""}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cargos extra — {customerName}</DialogTitle>
        </DialogHeader>

        {extras.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay cargos extra en esta cuota.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {extras.map((extra) => (
              <li
                key={extra.id}
                className={`flex items-center justify-between gap-3 rounded-md border p-2 text-sm ${extra.voided ? "opacity-50" : ""}`}
              >
                <div>
                  <span className={extra.voided ? "line-through" : ""}>{extra.conceptName}</span>
                  {extra.note && <span className="text-muted-foreground"> — {extra.note}</span>}
                  {extra.voided && <span className="ml-1 text-xs text-muted-foreground">(anulado)</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={extra.voided ? "line-through" : "font-medium"}>
                    {formatCurrency(extra.amount)}
                  </span>
                  {!extra.voided && (
                    <ConfirmAction
                      trigger={
                        <Button size="sm" variant="ghost" className="h-7 text-destructive">
                          Anular
                        </Button>
                      }
                      title="¿Anular este cargo?"
                      description="Deja de sumar a lo que se debe. No se borra el registro — queda visible como anulado."
                      confirmLabel="Anular cargo"
                      onConfirm={() => voidDueExtra(groupId, extra.id)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {concepts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No hay conceptos activos — cargalos primero en Configuración.
          </p>
        ) : (
          <form ref={formRef} action={formAction} className="flex flex-col gap-3 border-t pt-4">
            <p className="text-sm font-medium">Agregar cargo</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="concept_id">Concepto</Label>
                <input type="hidden" name="concept_id" value={conceptId} />
                <Select
                  items={conceptLabelsById}
                  value={conceptId}
                  onValueChange={(v) => v && setConceptId(v)}
                >
                  <SelectTrigger id="concept_id" className="w-full">
                    <SelectValue placeholder="Elegir" />
                  </SelectTrigger>
                  <SelectContent>
                    {concepts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">Importe</Label>
                <Input id="amount" name="amount" type="number" min="0.01" step="0.01" required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="note">Nota (opcional)</Label>
              <Input id="note" name="note" placeholder="Ej: tacho de 12kg" />
            </div>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Agregando..." : "Agregar cargo"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
