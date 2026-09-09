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
import { Plus } from "lucide-react";
import { createCampaign } from "./actions";

export function NewCampaignDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createCampaign, {});

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Nueva campaña
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva campaña</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" name="name" placeholder="Día de la Madre" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start_date">Inicio</Label>
              <Input id="start_date" name="start_date" type="date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">Fin</Label>
              <Input id="end_date" name="end_date" type="date" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="investment">Inversión</Label>
            <Input id="investment" name="investment" type="number" min="0" step="0.01" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="objective">Objetivo</Label>
            <Textarea id="objective" name="objective" rows={2} />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creando..." : "Crear campaña"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
