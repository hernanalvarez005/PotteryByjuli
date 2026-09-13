"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
import { BellPlus } from "lucide-react";
import { createReminder } from "./actions";

export function NewReminderDialog({ specialDates }: { specialDates: { id: string; title: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createReminder, {});
  const [specialDateId, setSpecialDateId] = useState("");
  const specialDateLabels = Object.fromEntries(specialDates.map((s) => [s.id, s.title]));

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) {
      setOpen(false);
      setSpecialDateId("");
    }
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <BellPlus className="size-4" />
        Recordatorio
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo recordatorio</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="reminder_title">Título</Label>
            <Input id="reminder_title" name="title" placeholder="Pedir presupuesto de arcilla" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="remind_at">Fecha</Label>
            <Input id="remind_at" name="remind_at" type="date" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <Textarea id="description" name="description" rows={2} />
          </div>
          {specialDates.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="special_date_id">Vincular a una fecha especial (opcional)</Label>
              <input type="hidden" name="special_date_id" value={specialDateId} />
              <Select
                items={specialDateLabels}
                value={specialDateId}
                onValueChange={(v) => setSpecialDateId(v ?? "")}
              >
                <SelectTrigger id="special_date_id" className="w-full">
                  <SelectValue placeholder="Ninguna" />
                </SelectTrigger>
                <SelectContent>
                  {specialDates.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
