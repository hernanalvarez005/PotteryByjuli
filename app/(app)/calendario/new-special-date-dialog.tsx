"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CalendarPlus } from "lucide-react";
import { createSpecialDate } from "./actions";

export function NewSpecialDateDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createSpecialDate, {});

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <CalendarPlus className="size-4" />
        Fecha especial
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva fecha especial</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="title">Título</Label>
            <Input id="title" name="title" placeholder="Día de la Madre" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">Fecha</Label>
            <Input id="date" name="date" type="date" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category">Categoría</Label>
            <Input id="category" name="category" placeholder="Comercial" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <Textarea id="description" name="description" rows={2} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="recurs_yearly" className="size-4" />
            Se repite todos los años
          </label>
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
