"use client";

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
import { UserPlus } from "lucide-react";
import { enrollCustomer } from "./actions";

export function EnrollDialog({
  groupId,
  customers,
}: {
  groupId: string;
  customers: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const boundAction = enrollCustomer.bind(null, groupId);
  const [state, formAction, isPending] = useActionState(boundAction, {});
  // Passed as Select's `items` prop so the trigger can resolve a label
  // for the selected customer — without it, Base UI's <Select.Value>
  // falls back to showing the raw id instead of the name.
  const customerLabels = Object.fromEntries(customers.map((c) => [c.id, c.name]));

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) {
      setOpen(false);
      setCustomerId("");
    }
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <UserPlus className="size-4" />
        Inscribir
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inscribir alumno/a</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="customer_id">Cliente</Label>
            <input type="hidden" name="customer_id" value={customerId} />
            <Select items={customerLabels} value={customerId} onValueChange={(v) => setCustomerId(v ?? "")}>
              <SelectTrigger id="customer_id" className="w-full">
                <SelectValue placeholder="Elegir cliente" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="monthly_fee">Cuota mensual (opcional)</Label>
            <Input id="monthly_fee" name="monthly_fee" type="number" min="0" step="0.01" />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending || !customerId}>
              {isPending ? "Inscribiendo..." : "Inscribir"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
