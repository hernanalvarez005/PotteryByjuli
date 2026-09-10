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
import { Plus, Trash2 } from "lucide-react";
import { createTransfer } from "./actions";

type Option = { id: string; name: string };
type ItemRow = { key: string; inventory_item_id: string; quantity: number };

export function TransferForm({
  locations,
  products,
}: {
  locations: Option[];
  products: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createTransfer, {});
  const [items, setItems] = useState<ItemRow[]>([
    { key: crypto.randomUUID(), inventory_item_id: "", quantity: 1 },
  ]);
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  // Passed as each Select's `items` prop so the trigger can resolve a
  // label for the selected value — without it, Base UI's <Select.Value>
  // falls back to showing the raw id instead of its label.
  const locationLabels = Object.fromEntries(locations.map((l) => [l.id, l.name]));
  const productLabels = Object.fromEntries(products.map((p) => [p.id, p.name]));

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) {
      setOpen(false);
      setItems([{ key: crypto.randomUUID(), inventory_item_id: "", quantity: 1 }]);
      setFromLocationId("");
      setToLocationId("");
    }
    wasPending.current = isPending;
  }, [isPending, state.error]);

  function updateItem(key: string, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  const validItems = items.filter((it) => it.inventory_item_id && it.quantity > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Nueva transferencia
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva transferencia</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input
            type="hidden"
            name="items"
            value={JSON.stringify(
              validItems.map((it) => ({
                inventory_item_id: it.inventory_item_id,
                quantity: it.quantity,
              }))
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="from_location_id">Origen</Label>
              <input type="hidden" name="from_location_id" value={fromLocationId} />
              <Select items={locationLabels} value={fromLocationId} onValueChange={(v) => setFromLocationId(v ?? "")}>
                <SelectTrigger id="from_location_id" className="w-full">
                  <SelectValue placeholder="Elegir" />
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
            <div className="space-y-1">
              <Label htmlFor="to_location_id">Destino</Label>
              <input type="hidden" name="to_location_id" value={toLocationId} />
              <Select items={locationLabels} value={toLocationId} onValueChange={(v) => setToLocationId(v ?? "")}>
                <SelectTrigger id="to_location_id" className="w-full">
                  <SelectValue placeholder="Elegir" />
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
          </div>

          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <div key={item.key} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Producto</Label>
                  <Select
                    items={productLabels}
                    value={item.inventory_item_id}
                    onValueChange={(value) =>
                      value && updateItem(item.key, { inventory_item_id: value })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Elegir producto" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-20 space-y-1">
                  <Label className="text-xs text-muted-foreground">Cant.</Label>
                  <Input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem(item.key, { quantity: Number(e.target.value) || 1 })
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={items.length === 1}
                  onClick={() =>
                    setItems((prev) => prev.filter((it) => it.key !== item.key))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                setItems((prev) => [
                  ...prev,
                  { key: crypto.randomUUID(), inventory_item_id: "", quantity: 1 },
                ])
              }
            >
              <Plus className="size-4" />
              Agregar producto
            </Button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="notes">Notas</Label>
            <Textarea id="notes" name="notes" rows={2} />
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending || validItems.length === 0 || !fromLocationId || !toLocationId}>
              {isPending ? "Creando..." : "Crear transferencia"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
