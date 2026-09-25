"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
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
} from "@/components/ui/dialog";
import { isoToArgentinaDate } from "@/lib/format";
import { MAX_FEATURED_PRODUCTS } from "@/schemas/wholesale-featured";
import { saveFeaturedSection } from "./featured-actions";
import { FeaturedProductPicker } from "./featured-product-picker";
import type { FeaturedSectionAdminRow } from "./featured-sections-manager";

const RECOMMENDED_MIN = 3;
const RECOMMENDED_MAX = 8;

type Item = { productId: string; name: string; hidden: boolean };

export function FeaturedSectionDialog({
  section,
  open,
  onOpenChange,
}: {
  /** null = sección nueva. */
  section: FeaturedSectionAdminRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{section ? "Editar sección destacada" : "Nueva sección destacada"}</DialogTitle>
        </DialogHeader>
        {/* Sin `open &&`: desmontar el formulario antes de que termine la
            animación de salida dejaba un cuadro vacío por un instante. El
            contenido del diálogo ya se desmonta solo al cerrarse, así que
            el formulario igual arranca limpio en cada apertura. */}
        <SectionForm section={section} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function SectionForm({ section, onDone }: { section: FeaturedSectionAdminRow | null; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState(saveFeaturedSection, {});
  const [title, setTitle] = useState(section?.title ?? "");
  const [description, setDescription] = useState(section?.description ?? "");
  const [isActive, setIsActive] = useState(section?.is_active ?? true);
  const [startsOn, setStartsOn] = useState(section?.starts_at ? isoToArgentinaDate(section.starts_at) : "");
  const [endsOn, setEndsOn] = useState(section?.ends_at ? isoToArgentinaDate(section.ends_at) : "");
  const [items, setItems] = useState<Item[]>(section?.products ?? []);

  // El formulario se remonta en cada apertura, así que `state.saved` sólo
  // puede ser true por el guardado de ESTA apertura.
  useEffect(() => {
    if (state.saved) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.saved]);

  const selectedIds = useMemo(() => new Set(items.map((i) => i.productId)), [items]);

  function move(index: number, delta: -1 | 1) {
    setItems((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {section && <input type="hidden" name="id" value={section.id} />}
      <input type="hidden" name="is_active" value={String(isActive)} />
      <input type="hidden" name="product_ids" value={JSON.stringify(items.map((i) => i.productId))} />

      <div className="space-y-2">
        <Label htmlFor="featured_title">Nombre</Label>
        <Input
          id="featured_title"
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ej: Día de la Madre"
          maxLength={80}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="featured_description">Descripción (opcional)</Label>
        <Textarea
          id="featured_description"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={500}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="featured_starts_on">Desde (opcional)</Label>
          <Input
            id="featured_starts_on"
            name="starts_on"
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="featured_ends_on">Hasta, inclusive (opcional)</Label>
          <Input
            id="featured_ends_on"
            name="ends_on"
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Sin fechas, la sección se muestra mientras esté activa. Con fechas, se activa y se desactiva sola.
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        Activa
        <span className="text-xs text-muted-foreground">(desactivarla la archiva, sin importar las fechas)</span>
      </label>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label>Productos ({items.length})</Label>
          <span className="text-xs text-muted-foreground">
            Recomendado: {RECOMMENDED_MIN} a {RECOMMENDED_MAX}
          </span>
        </div>

        {items.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Todavía no agregaste productos. Una sección sin productos visibles no se muestra.
          </p>
        ) : (
          <ol className="flex flex-col rounded-md border">
            {items.map((item, index) => (
              <li key={item.productId} className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0">
                <span className="w-5 shrink-0 text-xs text-muted-foreground">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{item.name}</p>
                  {item.hidden && (
                    <p className="text-xs text-amber-600">Oculto en mayorista — no se mostrará públicamente</p>
                  )}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Subir ${item.name}`}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Bajar ${item.name}`}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground"
                  onClick={() => setItems((prev) => prev.filter((p) => p.productId !== item.productId))}
                  aria-label={`Quitar ${item.name} de la sección`}
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            ))}
          </ol>
        )}

        {items.length > RECOMMENDED_MAX && (
          <p className="text-xs text-muted-foreground">
            Más de {RECOMMENDED_MAX} productos: la sección va a ocupar bastante espacio arriba del catálogo. Es sólo una
            recomendación.
          </p>
        )}

        {items.length < MAX_FEATURED_PRODUCTS ? (
          <FeaturedProductPicker
            selectedIds={selectedIds}
            onAdd={(p) => setItems((prev) => [...prev, { productId: p.id, name: p.name, hidden: false }])}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Llegaste al máximo de {MAX_FEATURED_PRODUCTS} productos.</p>
        )}
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isPending || !title.trim()}>
          {isPending ? "Guardando..." : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
