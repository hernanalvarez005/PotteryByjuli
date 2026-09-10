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
import { createExpense } from "./actions";

type Option = { id: string; name: string };

export function NewExpenseDialog({
  categories,
  methods,
  accounts,
  businessUnits,
}: {
  categories: Option[];
  methods: Option[];
  accounts: Option[];
  businessUnits: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createExpense, {});
  const [categoryId, setCategoryId] = useState("");
  const [methodId, setMethodId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [businessUnitId, setBusinessUnitId] = useState("");
  // Passed as each Select's `items` prop so the trigger can resolve a
  // label for the selected value — without it, Base UI's <Select.Value>
  // falls back to showing the raw id instead of its label.
  const categoryLabels = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const methodLabels = Object.fromEntries(methods.map((m) => [m.id, m.name]));
  const accountLabels = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  const businessUnitLabels = Object.fromEntries(businessUnits.map((b) => [b.id, b.name]));

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) {
      setOpen(false);
      setCategoryId("");
      setMethodId("");
      setAccountId("");
      setBusinessUnitId("");
    }
    wasPending.current = isPending;
  }, [isPending, state.error]);

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Nuevo gasto
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo gasto</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="expense_date">Fecha</Label>
              <Input id="expense_date" name="expense_date" type="date" defaultValue={todayIso} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Importe</Label>
              <Input id="amount" name="amount" type="number" min="0" step="0.01" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="concept">Concepto</Label>
            <Input id="concept" name="concept" placeholder="Arcilla x 50kg" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="category_id">Categoría</Label>
              <input type="hidden" name="category_id" value={categoryId} />
              <Select items={categoryLabels} value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
                <SelectTrigger id="category_id" className="w-full">
                  <SelectValue placeholder="Elegir" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor">Proveedor</Label>
              <Input id="vendor" name="vendor" />
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
            <Label htmlFor="business_unit_id">Unidad de negocio</Label>
            <input type="hidden" name="business_unit_id" value={businessUnitId} />
            <Select items={businessUnitLabels} value={businessUnitId} onValueChange={(v) => setBusinessUnitId(v ?? "")}>
              <SelectTrigger id="business_unit_id" className="w-full">
                <SelectValue placeholder="Elegir (opcional)" />
              </SelectTrigger>
              <SelectContent>
                {businessUnits.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
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
              {isPending ? "Guardando..." : "Guardar gasto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
