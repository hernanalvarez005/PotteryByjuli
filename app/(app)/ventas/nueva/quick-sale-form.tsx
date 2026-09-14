"use client";

import { useActionState, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
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
import { Minus, Plus, Search, Trash2, UserPlus, X } from "lucide-react";
import { formatCurrency, todayInArgentina } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { createCustomer } from "@/app/(app)/clientes/actions";
import { createQuickSale } from "./actions";
import { quickSaleSessionReducer } from "@/lib/quick-sale-session";

type Option = { id: string; name: string };
type Channel = { id: string; name: string; code: string };
type VariantOption = { id: string; label: string; retailPrice: number };
type Quote = { price_condition_id: string; price_condition_name: string; total: number };
type FeeSuggestion = { payment_method_id: string; account_id: string | null; suggested_percentage: number };

type CartLine = { key: string; variantId: string; label: string; quantity: number; unitPrice: number };

const FREQUENT_KEY = "quickSale.frequentVariants";
const LOCATION_KEY = "quickSale.lastLocationId";
const MAX_FREQUENT = 6;

function loadFrequentIds(): string[] {
  try {
    const raw = localStorage.getItem(FREQUENT_KEY);
    if (!raw) return [];
    const counts = JSON.parse(raw) as Record<string, number>;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_FREQUENT)
      .map(([id]) => id);
  } catch {
    return [];
  }
}

function bumpFrequent(variantId: string) {
  try {
    const raw = localStorage.getItem(FREQUENT_KEY);
    const counts = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    counts[variantId] = (counts[variantId] ?? 0) + 1;
    localStorage.setItem(FREQUENT_KEY, JSON.stringify(counts));
  } catch {
    // localStorage no disponible (modo privado, etc.) — no bloquea la venta.
  }
}

export function QuickSaleForm({
  variants,
  customers,
  locations,
  methods,
  accounts,
  channels,
  defaultChannelId,
  priceConditions,
  feeSuggestions,
}: {
  variants: VariantOption[];
  customers: Option[];
  locations: Option[];
  methods: Option[];
  accounts: Option[];
  channels: Channel[];
  defaultChannelId: string | null;
  priceConditions: Option[];
  feeSuggestions: FeeSuggestion[];
}) {
  const [state, formAction, isPending] = useActionState(createQuickSale, {});

  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [frequentIds, setFrequentIds] = useState<string[]>([]);
  const [locationId, setLocationId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  // Fecha comercial declarada (Bloque 2 — orders.sale_date): default hoy
  // en horario argentino, editable — separada de paidAt (cuándo se
  // cobró) y de created_at/sold_at (técnicas, no editables desde acá).
  const [saleDate, setSaleDate] = useState(() => todayInArgentina());
  const [customerId, setCustomerId] = useState("");
  const [customerLabel, setCustomerLabel] = useState("");
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [channelId, setChannelId] = useState(defaultChannelId ?? "");
  const [editingChannel, setEditingChannel] = useState(false);

  // Comisión (Bloque 3) — se precarga con la sugerencia configurada para
  // el método/cuenta elegidos, pero es siempre editable: lo que se cobra
  // de verdad puede diferir de la estimación. `feeTouched` es lo que
  // distingue "la usuaria ya la corrigió a mano" (no volver a pisarla)
  // de "todavía sigue la sugerencia" (recalcularla si cambia el método,
  // la cuenta o el total).
  const [manualFeeAmount, setManualFeeAmount] = useState(0);
  const [feeTouched, setFeeTouched] = useState(false);

  // Cards de cobro por condición (Bloque 3) — el frontend nunca calcula
  // un total: sólo pinta lo que quote_retail_sale devuelve para el
  // carrito actual. Se re-cotiza cada vez que cambia qué hay en el
  // carrito (nunca en cada tecla de otro campo del formulario).
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selectedConditionId, setSelectedConditionId] = useState("");

  // Estado de sesión separado del que devuelve useActionState — ver
  // lib/quick-sale-session.ts para el porqué (bug real: "Nueva venta" no
  // hacía nada porque la pantalla de éxito se guiaba por el resultado de
  // la action, que nunca se limpia solo).
  const [session, dispatchSession] = useReducer(quickSaleSessionReducer, null, () => ({
    clientRequestId: crypto.randomUUID(),
    success: null,
  }));

  useEffect(() => {
    if (state.result) {
      dispatchSession({ type: "sale_succeeded", result: state.result });
    }
  }, [state.result]);

  useEffect(() => {
    // Leer localStorage sólo puede pasar después del montaje (no hay
    // `window` durante SSR), así que esto no puede ser un inicializador
    // lazy de useState — un efecto es el único lugar donde esta lectura
    // única puede correr (mismo patrón ya usado en cart-context.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrequentIds(loadFrequentIds());
    try {
      const savedLocation = localStorage.getItem(LOCATION_KEY);
      if (savedLocation) setLocationId(savedLocation);
    } catch {
      // ignore
    }
  }, []);

  // Firma estable del carrito (variante+cantidad) — dispara una recotización
  // sólo cuando lo que hay para vender realmente cambió, nunca por un
  // re-render de otro campo del formulario.
  const cartSignature = useMemo(
    () => JSON.stringify(cart.map((line) => ({ v: line.variantId, q: line.quantity })).sort((a, b) => a.v.localeCompare(b.v))),
    [cart]
  );

  // `quoting` se deriva de si la última cotización recibida corresponde
  // a este carrito o a uno anterior — nunca un setState síncrono al
  // arrancar el efecto (eso dispara un render en cascada evitable); el
  // único setState real pasa dentro del callback async, cuando la
  // respuesta de verdad llega.
  const [quotesFor, setQuotesFor] = useState<string | null>(null);
  const quoting = cart.length > 0 && quotesFor !== cartSignature;

  useEffect(() => {
    const items = cart.map((line) => ({ product_variant_id: line.variantId, quantity: line.quantity }));
    if (items.length === 0) {
      // Carrito vacío: nada que cotizar. No hace falta limpiar `quotes`/
      // `selectedConditionId` acá — toda la sección de condiciones (y el
      // submit) ya está condicionada a `cart.length > 0` en el render, así
      // que un valor stale mientras el carrito está vacío no es visible
      // ni habilita nada.
      return;
    }

    let cancelled = false;
    const supabase = createClient();
    supabase
      .rpc("quote_retail_sale", { p_items: items })
      .then(({ data, error }) => {
        if (cancelled) return;
        const rows = error || !data ? [] : (data as Quote[]);
        setQuotes(rows);
        setQuotesFor(cartSignature);
        // Si la condición elegida ya no aparece en la nueva cotización
        // (se sacó un producto del carrito que sólo tenía precio ahí, o
        // se desactivó mientras tanto), se limpia la selección — nunca
        // se deja seleccionada una card que ya no es válida.
        setSelectedConditionId((prev) => (rows.some((q) => q.price_condition_id === prev) ? prev : ""));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSignature]);

  const selectedQuote = quotes.find((q) => q.price_condition_id === selectedConditionId) ?? null;
  // El RPC ya ordena por sort_order/nombre, pero se re-ordena acá contra
  // el orden que trajo la página — mismo orden que ve la usuaria en
  // /precios, nunca el orden en que las cards llegaron de la red.
  const conditionOrder = useMemo(
    () => new Map(priceConditions.map((c, i) => [c.id, i])),
    [priceConditions]
  );
  const orderedQuotes = useMemo(
    () =>
      [...quotes].sort(
        (a, b) => (conditionOrder.get(a.price_condition_id) ?? 0) - (conditionOrder.get(b.price_condition_id) ?? 0)
      ),
    [quotes, conditionOrder]
  );

  // Sugerencia de comisión (Bloque 3): la específica de método+cuenta
  // gana sobre la genérica del método — mismo orden de precedencia que
  // definen los dos índices únicos parciales de la migración.
  const suggestedPercentage = useMemo(() => {
    if (!paymentMethodId) return 0;
    const specific = feeSuggestions.find(
      (s) => s.payment_method_id === paymentMethodId && s.account_id === paymentAccountId
    );
    if (specific) return specific.suggested_percentage;
    const generic = feeSuggestions.find(
      (s) => s.payment_method_id === paymentMethodId && s.account_id === null
    );
    return generic?.suggested_percentage ?? 0;
  }, [feeSuggestions, paymentMethodId, paymentAccountId]);

  const estimatedFee = selectedQuote
    ? Math.round(selectedQuote.total * (suggestedPercentage / 100) * 100) / 100
    : 0;

  // Mientras la usuaria no haya corregido la comisión a mano, sigue a la
  // estimación — derivada en cada render a partir del método, la cuenta
  // y el total cotizado, nunca copiada a un estado propio (evita el
  // efecto-que-sólo-sincroniza-estado). En cuanto la toca, `feeTouched`
  // congela `manualFeeAmount` hasta el próximo "Nueva venta" o cambio de
  // método/cuenta.
  const feeAmount = feeTouched ? manualFeeAmount : estimatedFee;
  const estimatedNet = selectedQuote ? selectedQuote.total - feeAmount : 0;

  const variantById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);
  const locationLabels = useMemo(() => Object.fromEntries(locations.map((l) => [l.id, l.name])), [locations]);
  const methodLabels = useMemo(() => Object.fromEntries(methods.map((m) => [m.id, m.name])), [methods]);
  const accountLabels = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a.name])), [accounts]);
  const channelLabels = useMemo(() => Object.fromEntries(channels.map((c) => [c.id, c.name])), [channels]);

  const filteredVariants = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return variants.filter((v) => v.label.toLowerCase().includes(q)).slice(0, 20);
  }, [search, variants]);

  const frequentVariants = useMemo(
    () => frequentIds.map((id) => variantById.get(id)).filter((v): v is VariantOption => Boolean(v)),
    [frequentIds, variantById]
  );

  function addVariant(variant: VariantOption) {
    setCart((prev) => {
      const existing = prev.find((line) => line.variantId === variant.id);
      if (existing) {
        return prev.map((line) =>
          line.variantId === variant.id ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...prev,
        { key: crypto.randomUUID(), variantId: variant.id, label: variant.label, quantity: 1, unitPrice: variant.retailPrice },
      ];
    });
    bumpFrequent(variant.id);
    setFrequentIds(loadFrequentIds());
    setSearch("");
  }

  function updateQuantity(key: string, quantity: number) {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((line) => line.key !== key));
      return;
    }
    setCart((prev) => prev.map((line) => (line.key === key ? { ...line, quantity } : line)));
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((line) => line.key !== key));
  }

  const subtotal = cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);

  function resetForNewSale() {
    setCart([]);
    setSearch("");
    setCustomerId("");
    setCustomerLabel("");
    setQuotes([]);
    setSelectedConditionId("");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setSaleDate(todayInArgentina());
    setManualFeeAmount(0);
    setFeeTouched(false);
    // Forma de pago se resetea — a diferencia de la ubicación, no es un
    // default útil entre ventas (puede variar de una a la siguiente).
    setPaymentMethodId("");
    setPaymentAccountId("");
    // Limpia la pantalla de éxito y asigna un client_request_id nuevo —
    // la ubicación (locationId) es el único default que se mantiene a
    // propósito, no se toca acá.
    dispatchSession({ type: "start_new_sale", nextClientRequestId: crypto.randomUUID() });
  }

  function handleLocationChange(id: string) {
    setLocationId(id);
    try {
      localStorage.setItem(LOCATION_KEY, id);
    } catch {
      // ignore
    }
  }

  if (session.success) {
    const methodName = methodLabels[paymentMethodId] ?? "";
    return (
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-lg font-medium">✓ Venta registrada</p>
          <p className="text-2xl font-semibold">{formatCurrency(session.success.total)}</p>
          {methodName && <p className="text-muted-foreground">{methodName}</p>}
          <p className="text-sm text-muted-foreground">Stock actualizado</p>
          <div className="mt-4 flex gap-2">
            <Button onClick={resetForNewSale}>Nueva venta</Button>
            <Link href={`/pedidos/${session.success.orderId}`}>
              <Button variant="outline">Ver detalle</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const canSubmit =
    cart.length > 0 &&
    locationId &&
    paymentMethodId &&
    paidAt &&
    saleDate &&
    !!selectedQuote &&
    feeAmount >= 0 &&
    feeAmount <= selectedQuote.total &&
    !isPending;

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(
          cart.map((line) => ({
            product_variant_id: line.variantId,
            quantity: line.quantity,
            expected_unit_price: line.unitPrice,
          }))
        )}
      />
      <input type="hidden" name="location_id" value={locationId} />
      <input type="hidden" name="payment_method_id" value={paymentMethodId} />
      <input type="hidden" name="payment_account_id" value={paymentAccountId} />
      <input type="hidden" name="paid_at" value={paidAt} />
      <input type="hidden" name="sale_date" value={saleDate} />
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="channel_id" value={channelId} />
      <input type="hidden" name="client_request_id" value={session.clientRequestId} />
      <input type="hidden" name="price_condition_id" value={selectedConditionId} />
      <input type="hidden" name="expected_total" value={selectedQuote ? String(selectedQuote.total) : ""} />
      <input type="hidden" name="fee_amount" value={feeAmount} />

      {/* Buscador de producto */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto..."
            className="pl-9"
          />
        </div>

        {search.trim() ? (
          <div className="flex flex-col gap-1 rounded-md border">
            {filteredVariants.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">Sin resultados.</p>
            ) : (
              filteredVariants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => addVariant(v)}
                  className="flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span>{v.label}</span>
                  <span className="text-muted-foreground">{formatCurrency(v.retailPrice)}</span>
                </button>
              ))
            )}
          </div>
        ) : (
          frequentVariants.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {frequentVariants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => addVariant(v)}
                  className="rounded-full border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  {v.label}
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {/* Carrito */}
      {cart.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            {cart.map((line) => (
              <div key={line.key} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{line.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.quantity} × {formatCurrency(line.unitPrice)} = {formatCurrency(line.quantity * line.unitPrice)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    onClick={() => updateQuantity(line.key, line.quantity - 1)}
                  >
                    <Minus className="size-3.5" />
                  </Button>
                  <span className="w-6 text-center text-sm">{line.quantity}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    onClick={() => updateQuantity(line.key, line.quantity + 1)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  onClick={() => removeLine(line.key)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}

            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">Subtotal (precio de referencia)</span>
              <span className="text-sm">{formatCurrency(subtotal)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Condición de precio — el frontend nunca calcula, sólo pinta lo
          que quote_retail_sale devolvió para este carrito. */}
      {cart.length > 0 && (
        <div className="space-y-2">
          <Label>Condición de precio *</Label>
          {quoting && quotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Cotizando...</p>
          ) : orderedQuotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ninguna condición de precio activa tiene precio cargado para estos productos.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {orderedQuotes.map((q) => (
                <button
                  key={q.price_condition_id}
                  type="button"
                  onClick={() => setSelectedConditionId(q.price_condition_id)}
                  className={`min-w-[8.5rem] flex-1 rounded-lg border p-3 text-left transition-colors ${
                    selectedConditionId === q.price_condition_id
                      ? "border-primary bg-accent"
                      : "border-input hover:bg-accent/50"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {q.price_condition_name}
                  </p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(q.total)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ubicación */}
      <div className="space-y-2">
        <Label htmlFor="location_select">Ubicación *</Label>
        <Select items={locationLabels} value={locationId} onValueChange={(v) => v && handleLocationChange(v)}>
          <SelectTrigger id="location_select" className="w-full">
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

      {/* Pago */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="method_select">Forma de pago *</Label>
          <Select
            items={methodLabels}
            value={paymentMethodId}
            onValueChange={(v) => {
              if (!v) return;
              setPaymentMethodId(v);
              // Cambiar el método invalida cualquier corrección manual
              // anterior — la comisión de un método nuevo vuelve a
              // seguir su propia estimación hasta que se la edite de
              // nuevo.
              setFeeTouched(false);
            }}
          >
            <SelectTrigger id="method_select" className="w-full">
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
          <Label htmlFor="account_select">Cuenta</Label>
          <Select
            items={accountLabels}
            value={paymentAccountId}
            onValueChange={(v) => {
              setPaymentAccountId(v ?? "");
              setFeeTouched(false);
            }}
          >
            <SelectTrigger id="account_select" className="w-full">
              <SelectValue placeholder="(opcional)" />
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

      {/* Comisión y neto estimados (Bloque 3) — la sugerencia sólo
          orienta; lo que se guarda siempre es lo que quede acá, editado
          o no. El neto nunca es un campo: se ve, pero se deriva. */}
      {paymentMethodId && selectedQuote && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="fee_amount_input" className="shrink-0">
              Comisión {suggestedPercentage > 0 && !feeTouched ? `estimada (${suggestedPercentage}%)` : ""}
            </Label>
            <Input
              id="fee_amount_input"
              type="number"
              min="0"
              max={selectedQuote.total}
              step="0.01"
              value={feeAmount}
              onChange={(e) => {
                setFeeTouched(true);
                setManualFeeAmount(Number(e.target.value) || 0);
              }}
              className="w-32 text-right"
            />
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Neto estimado</span>
            <span className="tabular-nums">{formatCurrency(estimatedNet)}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="sale_date">Fecha de venta *</Label>
          <Input id="sale_date" type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} className="w-full" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="paid_at">Fecha de pago *</Label>
          <Input id="paid_at" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="w-full" />
        </div>
      </div>

      {/* Cliente (opcional) */}
      <div className="flex items-center gap-2">
        {customerId ? (
          <p className="text-sm">
            Cliente: <span className="font-medium">{customerLabel}</span>{" "}
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                setCustomerId("");
                setCustomerLabel("");
              }}
            >
              <X className="inline size-3.5" /> Quitar
            </button>
          </p>
        ) : (
          <Dialog open={customerPickerOpen} onOpenChange={setCustomerPickerOpen}>
            <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
              <UserPlus className="size-4" />
              Asociar cliente
            </DialogTrigger>
            <CustomerPickerDialogContent
              customers={customers}
              onPicked={(id, label) => {
                setCustomerId(id);
                setCustomerLabel(label);
                setCustomerPickerOpen(false);
              }}
            />
          </Dialog>
        )}
      </div>

      {/* Canal (default Presencial, editable) */}
      {editingChannel ? (
        <div className="space-y-2">
          <Label htmlFor="channel_select">Canal</Label>
          <Select items={channelLabels} value={channelId} onValueChange={(v) => v && setChannelId(v)}>
            <SelectTrigger id="channel_select" className="w-full sm:w-64">
              <SelectValue placeholder="Elegir canal" />
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
      ) : (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setEditingChannel(true)}
        >
          Canal: {channelLabels[channelId] ?? "Presencial"} · cambiar
        </button>
      )}

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" disabled={!canSubmit} size="lg" className="w-full sm:w-auto">
        {isPending
          ? "Registrando..."
          : selectedQuote
            ? `Registrar venta — ${formatCurrency(selectedQuote.total)}`
            : "Elegí una condición de precio"}
      </Button>
    </form>
  );
}

function CustomerPickerDialogContent({
  customers,
  onPicked,
}: {
  customers: Option[];
  onPicked: (id: string, label: string) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [pickedId, setPickedId] = useState("");
  const customerLabels = Object.fromEntries(customers.map((c) => [c.id, c.name]));

  const [createState, createFormAction, isCreating] = useActionState(createCustomer, {});
  const wasCreating = useRef(false);
  useEffect(() => {
    if (wasCreating.current && !isCreating && createState.customerId) {
      const created = customers.find((c) => c.id === createState.customerId);
      onPicked(createState.customerId, created?.name ?? "Cliente nuevo");
    }
    wasCreating.current = isCreating;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreating, createState.customerId]);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Asociar cliente</DialogTitle>
      </DialogHeader>

      <div className="flex gap-2 text-sm">
        <button
          type="button"
          className={mode === "existing" ? "font-medium underline" : "text-muted-foreground"}
          onClick={() => setMode("existing")}
        >
          Buscar existente
        </button>
        <span className="text-muted-foreground">·</span>
        <button
          type="button"
          className={mode === "new" ? "font-medium underline" : "text-muted-foreground"}
          onClick={() => setMode("new")}
        >
          Crear cliente
        </button>
      </div>

      {mode === "existing" ? (
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="picker_customer_id">Cliente</Label>
            <Select items={customerLabels} value={pickedId} onValueChange={(v) => setPickedId(v ?? "")}>
              <SelectTrigger id="picker_customer_id" className="w-full">
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
          <DialogFooter>
            <Button
              type="button"
              disabled={!pickedId}
              onClick={() => onPicked(pickedId, customerLabels[pickedId] ?? "")}
            >
              Asociar
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <form action={createFormAction} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="new_customer_first_name">Nombre</Label>
            <Input id="new_customer_first_name" name="first_name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new_customer_last_name">Apellido</Label>
            <Input id="new_customer_last_name" name="last_name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new_customer_whatsapp">WhatsApp</Label>
            <Input id="new_customer_whatsapp" name="whatsapp" />
          </div>
          {createState.error && <p className="text-sm text-destructive">{createState.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? "Creando..." : "Crear y asociar"}
            </Button>
          </DialogFooter>
        </form>
      )}
    </DialogContent>
  );
}
