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
import { createAdjustment } from "./actions";

export function AdjustmentDialog({
  inventoryItemId,
  locationId,
  productLabel,
  locationName,
}: {
  inventoryItemId: string;
  locationId: string;
  productLabel: string;
  locationName: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createAdjustment, {});

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>Ajustar</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Ajustar stock — {productLabel} ({locationName})
          </DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="inventory_item_id" value={inventoryItemId} />
          <input type="hidden" name="location_id" value={locationId} />
          <div className="space-y-2">
            <Label htmlFor="quantity">Cantidad (positiva suma, negativa resta)</Label>
            <Input id="quantity" name="quantity" type="number" step="1" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reason">Motivo</Label>
            <Textarea id="reason" name="reason" rows={2} required placeholder="Ej: conteo físico, rotura, corrección de carga" />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando..." : "Registrar ajuste"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
