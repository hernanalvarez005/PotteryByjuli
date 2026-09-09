"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
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
import { Plus } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { createDue, toggleDuePaid } from "./actions";

export type DueRow = {
  id: string;
  enrollmentId: string;
  customerName: string;
  period: string;
  amount: number;
  due_date: string | null;
  is_paid: boolean;
};

export function DuesPanel({
  groupId,
  dues,
  enrollments,
  canEdit,
}: {
  groupId: string;
  dues: DueRow[];
  enrollments: { id: string; customerName: string }[];
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      {canEdit && <NewDueDialog groupId={groupId} enrollments={enrollments} />}

      {dues.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay cuotas cargadas.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Alumno/a</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Importe</TableHead>
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
                <TableCell className="text-muted-foreground">
                  {due.due_date ? formatDate(due.due_date) : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={due.is_paid ? "secondary" : "outline"}>
                    {due.is_paid ? "Pagada" : "Pendiente"}
                  </Badge>
                </TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() =>
                        startTransition(() => toggleDuePaid(groupId, due.id, !due.is_paid))
                      }
                    >
                      {due.is_paid ? "Marcar pendiente" : "Marcar pagada"}
                    </Button>
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
        Nueva cuota
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
              <Label htmlFor="period">Período</Label>
              <Input id="period" name="period" placeholder="2026-09" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Importe</Label>
              <Input id="amount" name="amount" type="number" min="0" step="0.01" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="due_date">Vencimiento</Label>
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
