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
import { ConfirmAction } from "@/components/confirm-action";
import { UserPlus, MessageCircle } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { whatsappLink } from "@/lib/customers-shared";
import { REGISTRATION_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/schemas/events";
import {
  registerCustomer,
  setRegistrationPaymentStatus,
  setRegistrationStatus,
  deleteRegistration,
} from "./actions";

export type RegistrationRow = {
  id: string;
  customerName: string;
  participantName: string | null;
  whatsapp: string | null;
  quantity: number;
  unit_price: number | null;
  payment_status: string;
  status: string;
};

export function RegistrationsPanel({
  eventId,
  registrations,
  customers,
  defaultUnitPrice,
  canEdit,
  canDelete,
}: {
  eventId: string;
  registrations: RegistrationRow[];
  customers: { id: string; name: string }[];
  defaultUnitPrice: number | null;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const visible = registrations.filter((r) => r.status !== "cancelled");
  const confirmedOrAttended = visible.filter((r) => r.status === "confirmed" || r.status === "attended");
  const paid = confirmedOrAttended.filter((r) => r.payment_status === "paid").length;
  const pending = confirmedOrAttended.length - paid;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="Inscriptos" value={confirmedOrAttended.length} />
        <Stat label="Pagados" value={paid} />
        <Stat label="Pendientes" value={pending} />
        <Stat label="Total" value={visible.length} />
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <RegisterDialog eventId={eventId} customers={customers} unitPrice={defaultUnitPrice} />
        </div>
      )}

      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay inscriptos.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Participante</TableHead>
              <TableHead>Contacto</TableHead>
              <TableHead>Importe</TableHead>
              <TableHead>Pago</TableHead>
              <TableHead>Estado</TableHead>
              {(canEdit || canDelete) && <TableHead className="text-right">Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  {r.participantName ?? r.customerName}
                  {r.participantName && (
                    <span className="ml-2 text-xs text-muted-foreground">({r.customerName})</span>
                  )}
                </TableCell>
                <TableCell>
                  {r.whatsapp && (
                    <a
                      href={whatsappLink(r.whatsapp)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <MessageCircle className="size-3.5" />
                      {r.whatsapp}
                    </a>
                  )}
                </TableCell>
                <TableCell>
                  {r.unit_price != null ? formatCurrency(r.unit_price * r.quantity) : "—"}
                </TableCell>
                <TableCell>
                  {canEdit ? (
                    <Select
                      value={r.payment_status}
                      disabled={isPending}
                      onValueChange={(next) =>
                        next && startTransition(() => setRegistrationPaymentStatus(eventId, r.id, next))
                      }
                    >
                      <SelectTrigger className="h-8 w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant={r.payment_status === "paid" ? "secondary" : "outline"}>
                      {PAYMENT_STATUS_LABELS[r.payment_status]}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {canEdit ? (
                    <Select
                      value={r.status}
                      disabled={isPending}
                      onValueChange={(next) =>
                        next && startTransition(() => setRegistrationStatus(eventId, r.id, next))
                      }
                    >
                      <SelectTrigger className="h-8 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(REGISTRATION_STATUS_LABELS)
                          .filter(([value]) => value !== "cancelled")
                          .map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline">{REGISTRATION_STATUS_LABELS[r.status]}</Badge>
                  )}
                </TableCell>
                {(canEdit || canDelete) && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() =>
                            startTransition(() => setRegistrationStatus(eventId, r.id, "cancelled"))
                          }
                        >
                          Cancelar
                        </Button>
                      )}
                      {canDelete && r.payment_status === "pending" && (
                        <ConfirmAction
                          trigger={<Button size="sm" variant="ghost" className="text-destructive" />}
                          title="¿Eliminar esta inscripción?"
                          description="Sólo se puede porque todavía no tiene ningún pago registrado. Esta acción no se puede deshacer."
                          confirmLabel="Eliminar"
                          onConfirm={() => deleteRegistration(eventId, r.id)}
                        >
                          Eliminar
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
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
            <Label htmlFor="customer_id">Cliente / contacto</Label>
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
            <Label htmlFor="participant_name">Participante (si es distinto del contacto)</Label>
            <Input id="participant_name" name="participant_name" placeholder="Ej: hijo/a" />
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
