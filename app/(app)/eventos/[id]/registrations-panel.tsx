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
import { UserPlus } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { registerCustomer, toggleRegistrationPaid, cancelRegistration } from "./actions";

export type RegistrationRow = {
  id: string;
  customerName: string;
  quantity: number;
  unit_price: number | null;
  is_paid: boolean;
  status: string;
};

export function RegistrationsPanel({
  eventId,
  registrations,
  customers,
  defaultUnitPrice,
  canEdit,
}: {
  eventId: string;
  registrations: RegistrationRow[];
  customers: { id: string; name: string }[];
  defaultUnitPrice: number | null;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const active = registrations.filter((r) => r.status === "registered");

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div className="flex justify-end">
          <RegisterDialog eventId={eventId} customers={customers} unitPrice={defaultUnitPrice} />
        </div>
      )}

      {active.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay inscriptos.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Cantidad</TableHead>
              <TableHead>Importe</TableHead>
              <TableHead>Estado</TableHead>
              {canEdit && <TableHead className="text-right">Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.customerName}</TableCell>
                <TableCell>{r.quantity}</TableCell>
                <TableCell>
                  {r.unit_price != null ? formatCurrency(r.unit_price * r.quantity) : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={r.is_paid ? "secondary" : "outline"}>
                    {r.is_paid ? "Pagado" : "Pendiente"}
                  </Badge>
                </TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() =>
                          startTransition(() =>
                            toggleRegistrationPaid(eventId, r.id, !r.is_paid)
                          )
                        }
                      >
                        {r.is_paid ? "Marcar pendiente" : "Marcar pagado"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={isPending}
                        onClick={() => startTransition(() => cancelRegistration(eventId, r.id))}
                      >
                        Cancelar
                      </Button>
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

function RegisterDialog({
  eventId,
  customers,
  unitPrice,
}: {
  eventId: string;
  customers: { id: string; name: string }[];
  unitPrice: number | null;
}) {
  const [open, setOpen] = useState(false);
  const boundAction = registerCustomer.bind(null, eventId, unitPrice);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <UserPlus className="size-4" />
        Inscribir
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inscribir</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="customer_id">Cliente</Label>
            <Select name="customer_id" required>
              <SelectTrigger id="customer_id" className="w-full">
                <SelectValue placeholder="Elegir cliente" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="quantity">Cantidad</Label>
            <Input id="quantity" name="quantity" type="number" min="1" defaultValue={1} required />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Inscribiendo..." : "Inscribir"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
