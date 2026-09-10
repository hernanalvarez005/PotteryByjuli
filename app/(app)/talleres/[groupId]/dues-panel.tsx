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
import { createDue, registerDuePayment, cancelDue, addDueExtra, voidDueExtra } from "./actions";

export type DueExtraRow = {
  id: string;
  conceptName: string;
  amount: number;
  note: string | null;
  voided: boolean;
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
  concepts,
  canEdit,
}: {
  groupId: string;
  dues: DueRow[];
  enrollments: { id: string; customerName: string }[];
  paymentMethods: { id: string; name: string }[];
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
                      {due.displayStatus !== "paid" && due.displayStatus !== "cancelled" && (
                        <RegisterPaymentDialog
                          groupId={groupId}
                          dueId={due.id}
                          customerName={due.customerName}
                          balance={due.balance}
                          paymentMethods={paymentMethods}
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
            <Select value={enrollmentId} onValueChange={(v) => v && setEnrollmentId(v)}>
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
}: {
  groupId: string;
  dueId: string;
  customerName: string;
  balance: number;
  paymentMethods: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const boundAction = registerDuePayment.bind(null, groupId, dueId);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>Registrar pago</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago — {customerName}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
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
          <div className="space-y-2">
            <Label htmlFor="method_id">Medio de pago</Label>
            <Select name="method_id">
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
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando..." : "Registrar pago"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
