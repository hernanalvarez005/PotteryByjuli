"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
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
import { formatCurrency } from "@/lib/format";
import { buildAdjustmentPreview, type AdjustmentKind, type AdjustmentOperation } from "@/lib/pricing";
import { applyBulkPriceAdjustment } from "./actions";
import { useSelection } from "./selection-context";

export type ProductVariantForBulk = {
  variantId: string;
  productId: string;
  label: string;
  retail: number | null;
  wholesale: number | null;
};

// Passed as Select's `items` prop so the trigger shows the translated
// label immediately — without it, Base UI's <Select.Value> can't resolve
// a label for a value that's already selected before the popup has ever
// been opened (its item registry is empty until then) and falls back to
// showing the raw value ("retail" instead of "Minorista").
const LIST_SCOPE_LABELS = { retail: "Minorista", wholesale: "Mayorista", both: "Ambas" };
const KIND_LABELS = { percentage: "Porcentaje", fixed: "Importe fijo" };
const OPERATION_LABELS = { increase: "Aumentar", decrease: "Disminuir" };

export function BulkPriceBar({ variants }: { variants: ProductVariantForBulk[] }) {
  const { selected, clear } = useSelection();

  if (selected.size === 0) return null;

  return (
    <div className="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-sm">
      <span className="text-sm font-medium">{selected.size} seleccionado{selected.size > 1 ? "s" : ""}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={clear}>
          Cancelar selección
        </Button>
        <BulkPriceDialog selectedProductIds={[...selected]} variants={variants} onApplied={clear} />
      </div>
    </div>
  );
}

function BulkPriceDialog({
  selectedProductIds,
  variants,
  onApplied,
}: {
  selectedProductIds: string[];
  variants: ProductVariantForBulk[];
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [listScope, setListScope] = useState<"retail" | "wholesale" | "both">("retail");
  const [kind, setKind] = useState<AdjustmentKind>("percentage");
  const [operation, setOperation] = useState<AdjustmentOperation>("increase");
  const [value, setValue] = useState("5");

  const [state, formAction, isPending] = useActionState(applyBulkPriceAdjustment, {});

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error && !state.warning) {
      setOpen(false);
      onApplied();
    }
    wasPending.current = isPending;
  }, [isPending, state.error, state.warning, onApplied]);

  const selectedVariants = useMemo(
    () => variants.filter((v) => selectedProductIds.includes(v.productId)),
    [variants, selectedProductIds]
  );

  const previewRows = useMemo(() => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return [];
    const forList = (list: "retail" | "wholesale") =>
      selectedVariants
        .filter((v) => v[list] != null)
        .map((v) => ({ variantId: `${v.variantId}:${list}`, label: `${v.label} (${list === "retail" ? "minorista" : "mayorista"})`, currentPrice: v[list]! }));

    const rows = listScope === "both" ? [...forList("retail"), ...forList("wholesale")] : forList(listScope);
    return buildAdjustmentPreview(rows, { kind, operation, value: numericValue });
  }, [selectedVariants, listScope, kind, operation, value]);

  const variantIdsForSubmit = useMemo(() => selectedVariants.map((v) => v.variantId), [selectedVariants]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Ajustar precios</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajuste masivo de precios</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {variantIdsForSubmit.map((id) => (
            <input key={id} type="hidden" name="variant_id" value={id} />
          ))}
          <input type="hidden" name="list_scope" value={listScope} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="operation" value={operation} />
          <input type="hidden" name="value" value={value} />

          <div className="space-y-2">
            <Label>Lista</Label>
            <Select
              items={LIST_SCOPE_LABELS}
              value={listScope}
              onValueChange={(v) => v && setListScope(v as typeof listScope)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="retail">Minorista</SelectItem>
                <SelectItem value="wholesale">Mayorista</SelectItem>
                <SelectItem value="both">Ambas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select items={KIND_LABELS} value={kind} onValueChange={(v) => v && setKind(v as AdjustmentKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Porcentaje</SelectItem>
                  <SelectItem value="fixed">Importe fijo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Operación</Label>
              <Select
                items={OPERATION_LABELS}
                value={operation}
                onValueChange={(v) => v && setOperation(v as AdjustmentOperation)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="increase">Aumentar</SelectItem>
                  <SelectItem value="decrease">Disminuir</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{kind === "percentage" ? "%" : "$"}</Label>
              <Input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Preview — {previewRows.length} precio(s) afectado(s)
            </p>
            {previewRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ningún producto seleccionado tiene precio cargado en esta lista.
              </p>
            ) : (
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
                {previewRows.map((row) => (
                  <li key={row.variantId} className="flex items-center justify-between gap-2">
                    <span>{row.label}</span>
                    <span className="text-muted-foreground">
                      {formatCurrency(row.currentPrice)} → <span className="font-medium text-foreground">{formatCurrency(row.newPrice)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          {state.warning && <p className="text-sm text-destructive">{state.warning}</p>}
          {state.applied != null && (
            <p className="text-sm text-muted-foreground">{state.applied} precio(s) actualizados.</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={isPending || previewRows.length === 0}>
              {isPending ? "Aplicando..." : `Aplicar a ${previewRows.length} precio(s)`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
