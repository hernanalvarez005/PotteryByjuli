"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { applyWholesalePriceToAllVariants } from "./actions";

/**
 * "Aplicar a todas" sólo actualiza un preview local — no persiste nada
 * hasta que se confirma con "Guardar cambios", que ahí sí llama al server
 * action (una única vez, atómico). Si los precios mayoristas actuales ya
 * son distintos entre variantes, se avisa explícitamente antes de
 * unificarlos. La edición por celda existente (más abajo, en la tabla)
 * sigue siendo el camino para overrides puntuales después de aplicar el
 * precio masivo.
 */
export function BulkWholesalePriceForm({
  productId,
  variants,
  currentPrices,
}: {
  productId: string;
  variants: { id: string; name: string }[];
  /** variantId -> precio mayorista actual */
  currentPrices: Record<string, number | undefined>;
}) {
  const [draftPrice, setDraftPrice] = useState("");
  const [preview, setPreview] = useState<number | null>(null);
  const boundAction = applyWholesalePriceToAllVariants.bind(null, productId);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  if (variants.length === 0) return null;

  const existingPrices = variants
    .map((v) => currentPrices[v.id])
    .filter((p): p is number => p != null);
  const pricesDiffer = new Set(existingPrices).size > 1;

  function handleApplyToAll() {
    const value = Number(draftPrice);
    if (!Number.isFinite(value) || value < 0) return;
    setPreview(value);
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">Aplicar precio mayorista a todas las variantes</p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="0"
          step="0.01"
          value={draftPrice}
          onChange={(e) => {
            setDraftPrice(e.target.value);
            setPreview(null);
          }}
          placeholder="Precio"
          className="h-8 w-28"
        />
        <Button type="button" size="sm" variant="outline" onClick={handleApplyToAll} disabled={!draftPrice}>
          Aplicar a todas
        </Button>
      </div>

      {preview != null && (
        <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3">
          {pricesDiffer && (
            <p className="text-xs text-amber-700">
              Los precios mayoristas actuales no son iguales entre variantes — al guardar se van a unificar.
            </p>
          )}
          <ul className="flex flex-col gap-1 text-sm">
            {variants.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{v.name}</span>
                <span>
                  {currentPrices[v.id] != null
                    ? `$ ${currentPrices[v.id]!.toLocaleString("es-AR")}`
                    : "Sin definir"}
                  {" → "}
                  <span className="font-medium">$ {preview.toLocaleString("es-AR")}</span>
                </span>
              </li>
            ))}
          </ul>
          <form action={formAction} className="flex items-center gap-2">
            <input type="hidden" name="unit_price" value={preview} />
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Guardando..." : "Guardar cambios"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPreview(null)}>
              Cancelar
            </Button>
          </form>
          {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        </div>
      )}
    </div>
  );
}
