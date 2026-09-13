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
import { Plus } from "lucide-react";
import { createIncomeEntry } from "./actions";

type Option = { id: string; name: string };

export function NewIncomeDialog({
  methods,
  accounts,
  locations,
}: {
  methods: Option[];
  accounts: Option[];
  locations: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createIncomeEntry, {});
  const [methodId, setMethodId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [locationId, setLocationId] = useState("");
  // Pasado como `items` de cada Select para que el trigger pueda resolver
  // una etiqueta del valor elegido — sin esto, <Select.Value> de Base UI
  // muestra el id crudo en vez del nombre.
  const methodLabels = Object.fromEntries(methods.map((m) => [m.id, m.name]));
  const accountLabels = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  const locationLabels = Object.fromEntries(locations.map((l) => [l.id, l.name]));

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) {
      setOpen(false);
      setMethodId("");
      setAccountId("");
      setLocationId("");
    }
    wasPending.current = isPending;
  }, [isPending, state.error]);

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Nuevo ingreso
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo ingreso</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="occurred_at">Fecha</Label>
              <Input id="occurred_at" name="occurred_at" type="date" defaultValue={todayIso} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Importe</Label>
              <Input id="amount" name="amount" type="number" min="0" step="0.01" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="concept">Concepto</Label>
            <Input id="concept" name="concept" placeholder="Alquiler espacio Acuarela" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="category">Categoría</Label>
              <Input id="category" name="category" placeholder="Alquiler" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="counterparty">De quién</Label>
              <Input id="counterparty" name="counterparty" placeholder="Estudio Acuarela" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="method_id">Medio</Label>
              <input type="hidden" name="method_id" value={methodId} />
              <Select items={methodLabels} value={methodId} onValueChange={(v) => setMethodId(v ?? "")}>
                <SelectTrigger id="method_id" className="w-full">
                  <SelectValue placeholder="Elegir" />
                </SelectTrigger>
                <SelectContent>
                  {methods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="account_id">Cuenta</Label>
              <input type="hidden" name="account_id" value={accountId} />
              <Select items={accountLabels} value={accountId} onValueChange={(v) => setAccountId(v ?? "")}>
                <SelectTrigger id="account_id" className="w-full">
                  <SelectValue placeholder="Elegir" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="location_id">Ubicación</Label>
            <input type="hidden" name="location_id" value={locationId} />
            <Select items={locationLabels} value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
              <SelectTrigger id="location_id" className="w-full">
                <SelectValue placeholder="Elegir (opcional)" />
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
            <Label htmlFor="notes">Notas</Label>
            <Textarea id="notes" name="notes" rows={2} />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando..." : "Guardar ingreso"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
