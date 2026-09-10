"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  classifyProductsForDelete,
  bulkDeleteProducts,
  type ProductDeleteClassification,
  type BulkDeleteResult,
} from "./actions";
import { useSelection } from "./selection-context";

/**
 * Borrado múltiple con preview de clasificación — sección 9 del brief:
 * nunca una mezcla silenciosa de operaciones. El preview usa
 * classifyProductsForDelete (read-only, sólo para mostrarle a la usuaria
 * qué esperar) pero la confirmación llama a bulkDeleteProducts, que
 * re-chequea todo por su cuenta en el servidor — el preview nunca decide
 * el resultado final por sí solo.
 */
export function BulkDeleteBar({ canDelete }: { canDelete: boolean }) {
  const { selected, clear } = useSelection();

  if (!canDelete || selected.size === 0) return null;

  return <BulkDeleteButton selectedIds={[...selected]} onDone={clear} />;
}

function BulkDeleteButton({ selectedIds, onDone }: { selectedIds: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [classification, setClassification] = useState<ProductDeleteClassification[] | null>(null);
  const [result, setResult] = useState<BulkDeleteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    classifyProductsForDelete(selectedIds)
      .then(setClassification)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo clasificar la selección."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const deletable = classification?.filter((c) => c.deletable) ?? [];
  const blocked = classification?.filter((c) => !c.deletable) ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          // Reset happens here (an event handler), not synchronously in the
          // effect body below — the effect only performs the async fetch.
          setClassification(null);
          setResult(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" className="text-destructive" />}>
        Eliminar seleccionados
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Eliminar {selectedIds.length} producto(s)</DialogTitle>
        </DialogHeader>

        {!classification && !error && <p className="text-sm text-muted-foreground">Revisando...</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {classification && !result && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {selectedIds.length} seleccionado{selectedIds.length > 1 ? "s" : ""}: {deletable.length} se
              pueden eliminar{blocked.length > 0 && `, ${blocked.length} tienen historial y sólo se van a desactivar`}.
            </p>
            {blocked.length > 0 && (
              <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-2 text-sm">
                {blocked.map((b) => (
                  <li key={b.product_id} className="text-muted-foreground">
                    <span className="text-foreground">{b.product_name}</span> — {b.order_items_count} venta(s),{" "}
                    {b.movements_count} movimiento(s) de stock, {b.production_orders_count} orden(es) de producción
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {result && (
          <p className="text-sm">
            {result.deletedIds.length} producto(s) eliminado(s)
            {result.deactivatedIds.length > 0 && `, ${result.deactivatedIds.length} desactivado(s) por tener historial`}.
          </p>
        )}

        <DialogFooter>
          {!result ? (
            <Button
              variant="destructive"
              disabled={!classification || isPending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  try {
                    const r = await bulkDeleteProducts(selectedIds);
                    setResult(r);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
                  }
                })
              }
            >
              {isPending
                ? "Aplicando..."
                : deletable.length > 0 && blocked.length > 0
                  ? `Eliminar ${deletable.length} y desactivar ${blocked.length}`
                  : deletable.length > 0
                    ? `Eliminar ${deletable.length}`
                    : `Desactivar ${blocked.length}`}
            </Button>
          ) : (
            <Button
              onClick={() => {
                setOpen(false);
                onDone();
              }}
            >
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
