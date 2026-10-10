"use client";

import { useMemo, useState, useTransition } from "react";
import { Pencil, Plus, Sparkles, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";
import { VariantPicker } from "../nuevo/variant-picker";
import type { OrderVariantResult } from "@/lib/product-search";
import {
  PRICE_LIST_LABELS,
  priceListCodeForBusinessUnit,
  rowsMissingPrice,
  withManualPrice,
  withPickedVariant,
  type CatalogRowPricing,
} from "@/lib/order-pricing";
import {
  DELIVERED_WARNING,
  addsCatalogItems,
  buildChanges,
  increasesCatalogQuantity,
  itemRules,
  previewTotals,
  type CurrentItem,
  type DraftState,
  type ModifyChange,
} from "@/lib/order-modification";
import { modifyOrder } from "../actions";

export type ModifiableItem = CurrentItem & { label: string };

type CatalogAddRow = CatalogRowPricing & { key: string; kind: "catalog"; quantity: number };
type CustomAddRow = { key: string; kind: "custom"; custom_name: string; custom_description: string; quantity: number; unit_price: number };
type AddRow = CatalogAddRow | CustomAddRow;

const newCatalogRow = (): CatalogAddRow => ({
  key: crypto.randomUUID(),
  kind: "catalog",
  product_variant_id: "",
  variant_label: null,
  prices: null,
  quantity: 1,
  unit_price: null,
  priceSource: "list",
});

/**
 * "Modificar pedido" — operación explícita sobre un pedido ya creado (agregar
 * ítems, subir cantidad; bajar o quitar según el estado). Muestra la vista
 * previa del nuevo total y del saldo (los pagos no se tocan: saldo = nuevo
 * total − pagos). La regla real la decide `modify_order` en Postgres; acá
 * `itemRules` sólo evita ofrecer lo que el servidor va a rechazar.
 */
export function ModifyOrderDialog({
  orderId,
  humanCode,
  status,
  businessUnitCode,
  discountTotal,
  currentTotal,
  paid,
  items,
}: {
  orderId: string;
  humanCode: string;
  status: string;
  businessUnitCode: string | null;
  discountTotal: number;
  currentTotal: number;
  paid: number;
  items: ModifiableItem[];
}) {
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [rows, setRows] = useState<AddRow[]>([]);
  const [reason, setReason] = useState("");
  const [consumeStock, setConsumeStock] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const priceList = priceListCodeForBusinessUnit(businessUnitCode);
  const delivered = status === "delivered";

  function reset() {
    setQuantities({});
    setRemoved([]);
    setRows([]);
    setReason("");
    setConsumeStock(true);
    setError(null);
  }

  const addChanges: ModifyChange[] = useMemo(
    () =>
      rows.flatMap((r): ModifyChange[] => {
        if (r.kind === "catalog") {
          return r.product_variant_id && r.unit_price != null && r.quantity > 0
            ? [{ op: "add", product_variant_id: r.product_variant_id, quantity: r.quantity, unit_price: r.unit_price }]
            : [];
        }
        return r.custom_name.trim() && r.quantity > 0
          ? [
              {
                op: "add",
                custom_name: r.custom_name.trim(),
                ...(r.custom_description.trim() ? { custom_description: r.custom_description.trim() } : {}),
                quantity: r.quantity,
                unit_price: r.unit_price,
              },
            ]
          : [];
      }),
    [rows]
  );

  const draft: DraftState = useMemo(
    () => ({
      quantities,
      removed: new Set(removed),
      added: addChanges.flatMap((c) => (c.op === "add" ? [{ quantity: c.quantity, unit_price: c.unit_price }] : [])),
    }),
    [quantities, removed, addChanges]
  );

  const changes = useMemo(() => buildChanges(items, draft, addChanges), [items, draft, addChanges]);
  const preview = previewTotals({ items, draft, discountTotal, currentTotal, paid });
  const missingPrice = rowsMissingPrice(rows.filter((r): r is CatalogAddRow => r.kind === "catalog"));
  const remainingItems = items.filter((i) => !removed.includes(i.id)).length + addChanges.length;
  const movesStock = addsCatalogItems(addChanges) || increasesCatalogQuantity(items, draft);
  const anyBlocked = items.some((i) => itemRules(status, i.isCustom).blockedReason);
  const blockedMessage = items.map((i) => itemRules(status, i.isCustom).blockedReason).find(Boolean) ?? null;

  const canSubmit =
    changes.length > 0 && reason.trim().length > 0 && remainingItems > 0 && missingPrice.length === 0 && !isPending && preview.total >= 0;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await modifyOrder(orderId, { changes, reason, consume_stock: consumeStock });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="size-3.5" />
        Modificar pedido
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modificar {humanCode}</DialogTitle>
          <DialogDescription>
            Los pagos registrados no se tocan: el saldo es el nuevo total menos lo cobrado. Cada modificación queda registrada con su motivo.
          </DialogDescription>
        </DialogHeader>

        {delivered && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{DELIVERED_WARNING}</p>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Ítems del pedido</h3>
          {items.map((item) => {
            const rules = itemRules(status, item.isCustom);
            const isRemoved = removed.includes(item.id);
            const qty = quantities[item.id] ?? item.quantity;
            return (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                <span className={`flex-1 truncate ${isRemoved ? "text-muted-foreground line-through" : ""}`}>{item.label}</span>
                <span className="w-24 text-right text-xs text-muted-foreground">{formatCurrency(item.unit_price)}</span>
                <Input
                  type="number"
                  className="w-20"
                  min={rules.canDecrease ? 1 : item.quantity}
                  value={qty}
                  disabled={isRemoved || isPending}
                  aria-label={`Cantidad de ${item.label}`}
                  onChange={(e) => {
                    const raw = Math.floor(Number(e.target.value)) || item.quantity;
                    const next = rules.canDecrease ? Math.max(1, raw) : Math.max(item.quantity, raw);
                    setQuantities((prev) => ({ ...prev, [item.id]: next }));
                  }}
                />
                {rules.canRemove ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={isPending}
                    aria-label={isRemoved ? `Deshacer quitar ${item.label}` : `Quitar ${item.label}`}
                    onClick={() => setRemoved((prev) => (isRemoved ? prev.filter((id) => id !== item.id) : [...prev, item.id]))}
                  >
                    {isRemoved ? <Undo2 className="size-4" /> : <Trash2 className="size-4" />}
                  </Button>
                ) : (
                  <span className="size-9" />
                )}
              </div>
            );
          })}
          {anyBlocked && blockedMessage && <p className="text-xs text-muted-foreground">{blockedMessage}</p>}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Ítems a agregar</h3>
          {rows.map((row) =>
            row.kind === "catalog" ? (
              <div key={row.key} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Producto</Label>
                  <VariantPicker
                    selectedLabel={row.variant_label}
                    priceList={priceList}
                    onSelect={(variant: OrderVariantResult) =>
                      setRows((prev) => prev.map((r) => (r.key === row.key && r.kind === "catalog" ? withPickedVariant(r, variant, priceList) : r)))
                    }
                  />
                  {row.product_variant_id && row.prices?.[priceList] == null && (
                    <p className="text-xs text-amber-600">Sin precio {PRICE_LIST_LABELS[priceList]}, cargalo a mano.</p>
                  )}
                </div>
                <div className="w-20 space-y-1">
                  <Label className="text-xs text-muted-foreground">Cant.</Label>
                  <Input
                    type="number"
                    min={1}
                    value={row.quantity}
                    onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) } : r)))}
                  />
                </div>
                <div className="w-28 space-y-1">
                  <Label className="text-xs text-muted-foreground">Precio unit.</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.unit_price ?? ""}
                    placeholder={row.product_variant_id ? "Cargalo" : undefined}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r) => (r.key === row.key && r.kind === "catalog" ? withManualPrice(r, e.target.value === "" ? null : Number(e.target.value) || 0) : r))
                      )
                    }
                  />
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="Quitar fila" onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ) : (
              <div key={row.key} className="flex flex-col gap-2 rounded-md border border-dashed p-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">Nombre / descripción del ítem *</Label>
                    <Input
                      value={row.custom_name}
                      placeholder="Ej: 1 taza personalizada"
                      onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key && r.kind === "custom" ? { ...r, custom_name: e.target.value } : r)))}
                    />
                  </div>
                  <div className="w-20 space-y-1">
                    <Label className="text-xs text-muted-foreground">Cant.</Label>
                    <Input
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) } : r)))}
                    />
                  </div>
                  <div className="w-28 space-y-1">
                    <Label className="text-xs text-muted-foreground">Precio unit.</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.unit_price}
                      onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key && r.kind === "custom" ? { ...r, unit_price: Number(e.target.value) || 0 } : r)))}
                    />
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label="Quitar fila" onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <Textarea
                  rows={2}
                  placeholder="Notas / especificaciones (opcional)"
                  value={row.custom_description}
                  onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key && r.kind === "custom" ? { ...r, custom_description: e.target.value } : r)))}
                />
              </div>
            )
          )}
          <div className="flex gap-2 self-start">
            <Button type="button" variant="outline" size="sm" onClick={() => setRows((prev) => [...prev, newCatalogRow()])}>
              <Plus className="size-4" />
              Agregar producto
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRows((prev) => [...prev, { key: crypto.randomUUID(), kind: "custom", custom_name: "", custom_description: "", quantity: 1, unit_price: 0 }])}
            >
              <Sparkles className="size-4" />
              Agregar ítem personalizado
            </Button>
          </div>
        </section>

        {movesStock &&
          (delivered ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 size-4" checked={consumeStock} onChange={(e) => setConsumeStock(e.target.checked)} />
              <span>
                Descontar del stock
                <span className="block text-xs text-muted-foreground">
                  Registra una salida de stock por lo agregado. Desmarcalo si esa pieza ya se descontó o salió por otro lado.
                </span>
              </span>
            </label>
          ) : status !== "pending" ? (
            <p className="text-xs text-muted-foreground">Se reservará stock para lo agregado y se generará producción por lo que falte.</p>
          ) : null)}

        <section className="flex flex-col gap-1 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total actual</span>
            <span>{formatCurrency(currentTotal)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Nuevo total{preview.totalDelta !== 0 ? ` (${preview.totalDelta > 0 ? "+" : "−"}${formatCurrency(Math.abs(preview.totalDelta))})` : ""}</span>
            <span>{formatCurrency(preview.total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cobrado (no se modifica)</span>
            <span>{formatCurrency(paid)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Saldo</span>
            <span className={preview.balance > 0 ? "text-amber-600" : ""}>{formatCurrency(preview.balance)}</span>
          </div>
        </section>

        <div className="space-y-2">
          <Label htmlFor="modify-order-reason">Motivo (obligatorio)</Label>
          <Textarea
            id="modify-order-reason"
            rows={2}
            maxLength={300}
            value={reason}
            disabled={isPending}
            placeholder="Ej: pidieron una pieza adicional después de la primera entrega"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {missingPrice.length > 0 && <p className="text-sm text-amber-600">Falta el precio de: {missingPrice.map((r) => r.variant_label).join(", ")}.</p>}
        {remainingItems === 0 && <p className="text-sm text-amber-600">El pedido tiene que conservar al menos un ítem.</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {isPending ? "Guardando..." : "Aplicar modificación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
