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
import { updateGroupCapacity } from "./actions";

export function EditCapacityDialog({
  groupId,
  currentCapacity,
  activeCount,
}: {
  groupId: string;
  currentCapacity: number;
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const boundAction = updateGroupCapacity.bind(null, groupId);
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
          <DialogTitle>Cupos del grupo</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="capacity">Capacidad</Label>
            <Input id="capacity" name="capacity" type="number" min="1" step="1" defaultValue={currentCapacity} required />
            <p className="text-xs text-muted-foreground">
              {activeCount} inscripta{activeCount !== 1 ? "s" : ""} · {Math.max(0, currentCapacity - activeCount)} disponible
              {Math.max(0, currentCapacity - activeCount) !== 1 ? "s" : ""}
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
