"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { createEvent } from "./actions";

export function NewEventDialog({
  locations,
  paymentAccounts,
}: {
  locations: { id: string; name: string }[];
  paymentAccounts: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createEvent, {});
  const [locationId, setLocationId] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  // Passed as each Select's `items` prop so the trigger can resolve a
  // label for the selected value — without it, Base UI's <Select.Value>
  // falls back to showing the raw id instead of its label.
  const locationLabels = Object.fromEntries(locations.map((l) => [l.id, l.name]));
  const paymentAccountLabels = Object.fromEntries(paymentAccounts.map((a) => [a.id, a.name]));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Nuevo evento
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo evento</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="event_type">Tipo</Label>
            <Select
              name="event_type"
              items={{ workshop: "Workshop", fair: "Feria" }}
              defaultValue="workshop"
            >
              <SelectTrigger id="event_type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workshop">Workshop</SelectItem>
                <SelectItem value="fair">Feria</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" name="name" placeholder="Workshop Niños" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">Link público (opcional, se genera solo)</Label>
            <Input id="slug" name="slug" placeholder="ceramica-ninos-la-plata-septiembre" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <Textarea id="description" name="description" rows={2} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="event_date">Fecha</Label>
              <Input id="event_date" name="event_date" type="date" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="start_time">Desde</Label>
              <Input id="start_time" name="start_time" type="time" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_time">Hasta</Label>
              <Input id="end_time" name="end_time" type="time" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="location_id">Ubicación</Label>
            <input type="hidden" name="location_id" value={locationId} />
            <Select items={locationLabels} value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
              <SelectTrigger id="location_id" className="w-full">
                <SelectValue placeholder="Elegir ubicación" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Dirección (opcional)</Label>
            <Input id="address" name="address" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="capacity">Cupo</Label>
              <Input id="capacity" name="capacity" type="number" min="1" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Precio</Label>
              <Input id="price" name="price" type="number" min="0" step="0.01" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost_estimate">Costo est.</Label>
              <Input id="cost_estimate" name="cost_estimate" type="number" min="0" step="0.01" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment_account_id">Cuenta para transferencia</Label>
            <input type="hidden" name="payment_account_id" value={paymentAccountId} />
            <Select items={paymentAccountLabels} value={paymentAccountId} onValueChange={(v) => setPaymentAccountId(v ?? "")}>
              <SelectTrigger id="payment_account_id" className="w-full">
                <SelectValue placeholder="Elegir cuenta (opcional)" />
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
          <div className="space-y-2">
            <Label htmlFor="additional_info">Información adicional (qué incluye, condiciones)</Label>
            <Textarea id="additional_info" name="additional_info" rows={2} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notas internas</Label>
            <Textarea id="notes" name="notes" rows={2} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_registration_open" defaultChecked className="size-4" />
            Inscripciones abiertas
          </label>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creando..." : "Crear evento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
