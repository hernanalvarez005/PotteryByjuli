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
import { Pencil } from "lucide-react";
import { updateGroupMonthlyFee } from "./actions";

export function EditMonthlyFeeDialog({ groupId, currentFee }: { groupId: string; currentFee: number | null }) {
  const [open, setOpen] = useState(false);
  const boundAction = updateGroupMonthlyFee.bind(null, groupId);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-xs" />}>
        <Pencil className="size-3" />
        Editar
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cuota mensual del grupo</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="monthly_fee">Importe</Label>
            <Input
              id="monthly_fee"
              name="monthly_fee"
              type="number"
              min="0"
              step="0.01"
              defaultValue={currentFee ?? ""}
              placeholder="Sin configurar"
            />
            <p className="text-xs text-muted-foreground">
              Se usa para generar las cuotas del mes. Cambiarla no modifica cuotas ya generadas.
            </p>
          </div>
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
