"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { createOrder } from "../actions";

type Option = { id: string; name: string };
type VariantOption = {
  id: string;
  label: string;
  retailPrice: number | null;
};

type ItemRow = { key: string; product_variant_id: string; quantity: number; unit_price: number };

const DELIVERY_LABELS: Record<string, string> = {
  pickup: "Retiro",
  shipping: "Envío",
  other: "Otro",
};

export function OrderForm({
  customers,
  businessUnits,
  channels,
  locations,
  variants,
}: {
  customers: Option[];
  businessUnits: Option[];
  channels: Option[];
  locations: Option[];
  variants: VariantOption[];
}) {
  const [state, formAction, isPending] = useActionState(createOrder, {});
  const [customerId, setCustomerId] = useState("");
  const [businessUnitId, setBusinessUnitId] = useState("");
  const [originChannelId, setOriginChannelId] = useState("");
  const [closingChannelId, setClosingChannelId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [items, setItems] = useState<ItemRow[]>([
    { key: crypto.randomUUID(), product_variant_id: "", quantity: 1, unit_price: 0 },
  ]);

  const variantById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);
  // Passed as each Select's `items` prop so the trigger can resolve a
  // label for a value that's already selected before the popup has ever
  // registered its <Select.Item>s — without it, Base UI's <Select.Value>
  // falls back to showing the raw id/enum value instead of its label
  // (same root cause already fixed in the bulk-price dialog, the
  // /mayorista product-card variant selector, and the workshop due-extras
  // dialog — this form was the one place it never got applied).
  const customerLabels = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c.name])), [customers]);
  const businessUnitLabels = useMemo(() => Object.fromEntries(businessUnits.map((b) => [b.id, b.name])), [businessUnits]);
  const channelLabels = useMemo(() => Object.fromEntries(channels.map((c) => [c.id, c.name])), [channels]);
  const locationLabels = useMemo(() => Object.fromEntries(locations.map((l) => [l.id, l.name])), [locations]);
  const variantLabels = useMemo(() => Object.fromEntries(variants.map((v) => [v.id, v.label])), [variants]);

  function updateItem(key: string, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function addRow() {
    setItems((prev) => [
      ...prev,
      { key: crypto.randomUUID(), product_variant_id: "", quantity: 1, unit_price: 0 },
    ]);
  }

  function removeRow(key: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev));
  }

  const validItems = items.filter((it) => it.product_variant_id && it.quantity > 0);
  const subtotal = validItems.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(
          validItems.map((it) => ({
            product_variant_id: it.product_variant_id,
            quantity: it.quantity,
            unit_price: it.unit_price,
          }))
        )}
      />
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="business_unit_id" value={businessUnitId} />
      <input type="hidden" name="origin_channel_id" value={originChannelId} />
      <input type="hidden" name="closing_channel_id" value={closingChannelId} />
      <input type="hidden" name="location_id" value={locationId} />
      <input type="hidden" name="delivery_method" value={deliveryMethod} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos del pedido</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="customer_id_select">Cliente</Label>
            <Select items={customerLabels} value={customerId} onValueChange={(v) => v && setCustomerId(v)}>
              <SelectTrigger id="customer_id_select" className="w-full">
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
            <Label htmlFor="business_unit_id_select">Unidad de negocio</Label>
            <Select items={businessUnitLabels} value={businessUnitId} onValueChange={(v) => v && setBusinessUnitId(v)}>
              <SelectTrigger id="business_unit_id_select" className="w-full">
                <SelectValue placeholder="Elegir unidad" />
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
            <Label htmlFor="origin_channel_id_select">Origen comercial</Label>
            <Select items={channelLabels} value={originChannelId} onValueChange={(v) => v && setOriginChannelId(v)}>
              <SelectTrigger id="origin_channel_id_select" className="w-full">
                <SelectValue placeholder="¿Dónde conoció Pottery?" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="closing_channel_id_select">Canal de cierre</Label>
            <Select items={channelLabels} value={closingChannelId} onValueChange={(v) => v && setClosingChannelId(v)}>
              <SelectTrigger id="closing_channel_id_select" className="w-full">
                <SelectValue placeholder="¿Dónde se cerró?" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="location_id_select">Ubicación</Label>
            <Select items={locationLabels} value={locationId} onValueChange={(v) => v && setLocationId(v)}>
              <SelectTrigger id="location_id_select" className="w-full">
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
            <Label htmlFor="delivery_method_select">Entrega</Label>
            <Select items={DELIVERY_LABELS} value={deliveryMethod} onValueChange={(v) => v && setDeliveryMethod(v)}>
              <SelectTrigger id="delivery_method_select" className="w-full">
                <SelectValue placeholder="Elegir modalidad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pickup">Retiro</SelectItem>
                <SelectItem value="shipping">Envío</SelectItem>
                <SelectItem value="other">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {deliveryMethod === "shipping" && (
            <div className="col-span-2 space-y-2">
              <Label htmlFor="delivery_address">Dirección de envío</Label>
              <Input id="delivery_address" name="delivery_address" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="estimated_date">Fecha estimada</Label>
            <Input id="estimated_date" name="estimated_date" type="date" />
          </div>
          <div className="col-span-2 space-y-2">
            <Label htmlFor="notes">Observaciones</Label>
            <Textarea id="notes" name="notes" rows={2} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Productos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.key} className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">Producto</Label>
                <Select
                  items={variantLabels}
                  value={item.product_variant_id}
                  onValueChange={(value) => {
                    if (!value) return;
                    const variant = variantById.get(value);
                    updateItem(item.key, {
                      product_variant_id: value,
                      unit_price: variant?.retailPrice ?? 0,
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Elegir producto" />
                  </SelectTrigger>
                  <SelectContent>
                    {variants.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.label}
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
              <div className="w-28 space-y-1">
                <Label className="text-xs text-muted-foreground">Precio unit.</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unit_price}
                  onChange={(e) =>
                    updateItem(item.key, { unit_price: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(item.key)}
                disabled={items.length === 1}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" onClick={addRow} className="self-start">
            <Plus className="size-4" />
            Agregar producto
          </Button>

          <div className="flex justify-end border-t pt-3 text-sm font-medium">
            Subtotal: {formatCurrency(subtotal)}
          </div>
        </CardContent>
      </Card>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button
        type="submit"
        disabled={isPending || validItems.length === 0 || !customerId || !businessUnitId}
        className="self-start"
      >
        {isPending ? "Creando pedido..." : "Crear pedido"}
      </Button>
    </form>
  );
}
