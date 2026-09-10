"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateEvent } from "./actions";

export type EditableEvent = {
  event_type: string;
  name: string;
  slug: string | null;
  description: string | null;
  location_id: string | null;
  address: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  schedule: string | null;
  capacity: number | null;
  price: number | null;
  cost_estimate: number | null;
  payment_account_id: string | null;
  additional_info: string | null;
  is_registration_open: boolean;
  notes: string | null;
};

export function EditEventForm({
  eventId,
  event,
  locations,
  paymentAccounts,
  canEdit,
}: {
  eventId: string;
  event: EditableEvent;
  locations: { id: string; name: string }[];
  paymentAccounts: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const boundAction = updateEvent.bind(null, eventId);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Datos del evento</CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit} className="contents">
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="event_type" value={event.event_type} />
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" name="name" defaultValue={event.name} required />
            </div>
            {event.event_type === "workshop" && (
              <div className="space-y-2">
                <Label htmlFor="slug">Link público</Label>
                <Input id="slug" name="slug" defaultValue={event.slug ?? ""} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea id="description" name="description" rows={2} defaultValue={event.description ?? ""} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="event_date">Fecha</Label>
                <Input id="event_date" name="event_date" type="date" defaultValue={event.event_date} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="start_time">Desde</Label>
                <Input id="start_time" name="start_time" type="time" defaultValue={event.start_time ?? ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">Hasta</Label>
                <Input id="end_time" name="end_time" type="time" defaultValue={event.end_time ?? ""} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="location_id">Ubicación</Label>
              <Select
                name="location_id"
                items={locations.map((l) => ({ value: l.id, label: l.name }))}
                defaultValue={event.location_id ?? undefined}
              >
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
              <Label htmlFor="address">Dirección</Label>
              <Input id="address" name="address" defaultValue={event.address ?? ""} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="capacity">Cupo</Label>
                <Input id="capacity" name="capacity" type="number" min="1" defaultValue={event.capacity ?? ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price">Precio</Label>
                <Input id="price" name="price" type="number" min="0" step="0.01" defaultValue={event.price ?? ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cost_estimate">Costo est.</Label>
                <Input
                  id="cost_estimate"
                  name="cost_estimate"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={event.cost_estimate ?? ""}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment_account_id">Cuenta para transferencia</Label>
              <Select
                name="payment_account_id"
                items={paymentAccounts.map((a) => ({ value: a.id, label: a.name }))}
                defaultValue={event.payment_account_id ?? undefined}
              >
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
              <Label htmlFor="additional_info">Información adicional</Label>
              <Textarea
                id="additional_info"
                name="additional_info"
                rows={2}
                defaultValue={event.additional_info ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notas internas</Label>
              <Textarea id="notes" name="notes" rows={2} defaultValue={event.notes ?? ""} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="is_registration_open"
                defaultChecked={event.is_registration_open}
                className="size-4"
              />
              Inscripciones abiertas
            </label>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            {canEdit && (
              <Button type="submit" disabled={isPending} className="self-start">
                {isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            )}
          </form>
        </fieldset>
      </CardContent>
    </Card>
  );
}
