"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { WEEKDAY_LABELS } from "@/schemas/workshops";
import { createGroup } from "./actions";

export function NewGroupDialog({
  programs,
  locations,
}: {
  programs: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createGroup, {});

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Nuevo grupo
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo grupo</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="program_id">Programa</Label>
            <Select name="program_id" required>
              <SelectTrigger id="program_id" className="w-full">
                <SelectValue placeholder="Elegir programa" />
              </SelectTrigger>
              <SelectContent>
                {programs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Nombre del grupo</Label>
            <Input id="name" name="name" placeholder="Martes 18hs" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="schedule">Horario (texto libre, para mostrar)</Label>
            <Input id="schedule" name="schedule" placeholder="Martes 18 a 20hs" />
          </div>
          <p className="text-xs text-muted-foreground">
            Día y horario estructurados — para que la clase aparezca sola en el{" "}
            <Link href="/calendario" className="underline underline-offset-2">
              calendario
            </Link>
            .
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="weekday">Día</Label>
              <Select name="weekday">
                <SelectTrigger id="weekday" className="w-full">
                  <SelectValue placeholder="Elegir" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="capacity">Cupo</Label>
              <Input id="capacity" name="capacity" type="number" min="1" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="monthly_fee">Cuota mensual (opcional)</Label>
              <Input id="monthly_fee" name="monthly_fee" type="number" min="0" step="0.01" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="location_id">Ubicación</Label>
            <Select name="location_id">
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
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creando..." : "Crear grupo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
