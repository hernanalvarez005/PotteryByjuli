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
import { Plus } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { DUE_STATUS_LABELS, type DueDisplayStatus } from "@/lib/workshop-dues";
import { createDue, registerDuePayment, cancelDue } from "./actions";

export type DueRow = {
  id: string;
  enrollmentId: string;
  customerName: string;
  period: string;
  amount: number;
  due_date: string | null;
  paidAmount: number;
  balance: number;
  displayStatus: DueDisplayStatus;
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
  canEdit,
}: {
  groupId: string;
  dues: DueRow[];
  enrollments: { id: string; customerName: string }[];
  paymentMethods: { id: string; name: string }[];
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
                <TableCell>{formatCurrency(due.amount)}</TableCell>
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
