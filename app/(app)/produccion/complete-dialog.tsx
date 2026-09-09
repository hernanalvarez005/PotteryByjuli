"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { completeProductionOrder } from "./actions";

export function CompleteDialog({ id, quantity }: { id: string; quantity: number }) {
  const [open, setOpen] = useState(false);
  const boundAction = completeProductionOrder.bind(null, id);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" className="w-full" />}>Completar</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Completar orden ({quantity} pedidas)</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="produced_quantity">Producidas OK</Label>
              <Input
                id="produced_quantity"
                name="produced_quantity"
                type="number"
                min="0"
                defaultValue={quantity}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rejected_quantity">Merma / rechazo</Label>
              <Input
                id="rejected_quantity"
                name="rejected_quantity"
                type="number"
                min="0"
                defaultValue={0}
                required
              />
            </div>
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
