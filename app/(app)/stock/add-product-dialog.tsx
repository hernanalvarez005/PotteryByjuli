"use client";

import Link from "next/link";
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
import { createAdjustment } from "./actions";

/**
 * "+ Agregar producto" desde Stock (sección 37) — nunca un segundo
 * catálogo: si el producto ya existe, esto es sólo el mismo ajuste de
 * inventario de siempre (createAdjustment) con producto+ubicación
 * elegidos a mano en vez de venir fijos de una fila. Si no existe
 * todavía, el link va al mismo formulario de creación de /productos —
 * no uno paralelo — y se vuelve a Stock a cargar la cantidad inicial una
 * vez creado.
 */
export function AddProductDialog({
  products,
  locations,
}: {
  products: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createAdjustment, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  // Passed as each Select's `items` prop so the trigger can resolve a
  // label for the selected value — without it, Base UI's <Select.Value>
  // falls back to showing the raw id instead of its label.
  const productLabels = Object.fromEntries(products.map((p) => [p.id, p.name]));
  const locationLabels = Object.fromEntries(locations.map((l) => [l.id, l.name]));

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) {
      setOpen(false);
      formRef.current?.reset();
      setInventoryItemId("");
      setLocationId("");
    }
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Agregar producto
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar producto a Stock</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={formAction} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="inventory_item_id">Producto</Label>
            <input type="hidden" name="inventory_item_id" value={inventoryItemId} />
            <Select items={productLabels} value={inventoryItemId} onValueChange={(v) => setInventoryItemId(v ?? "")}>
              <SelectTrigger id="inventory_item_id" className="w-full">
                <SelectValue placeholder="Elegir producto existente" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              ¿No está en la lista?{" "}
              <Link href="/productos" className="underline underline-offset-2">
                Creá el producto acá
              </Link>{" "}
              y volvé a Stock para cargar su cantidad inicial.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="location_id">Ubicación</Label>
            <input type="hidden" name="location_id" value={locationId} />
            <Select items={locationLabels} value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
              <SelectTrigger id="location_id" className="w-full">
                <SelectValue placeholder="Elegir ubicación" />
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
            <Label htmlFor="quantity">Cantidad inicial</Label>
            <Input id="quantity" name="quantity" type="number" step="1" min="1" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reason">Motivo</Label>
            <Textarea id="reason" name="reason" rows={2} required placeholder="Ej: stock inicial" />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending || !inventoryItemId || !locationId}>
              {isPending ? "Guardando..." : "Agregar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
