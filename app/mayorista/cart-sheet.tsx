"use client";

import { useActionState, useMemo, useState, type ChangeEvent } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ShoppingCart } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { whatsappLink } from "@/lib/customers-shared";
import type { WholesaleProduct, WholesaleSettingsPublic } from "@/lib/wholesale";
import { validateWholesaleCart, type CartLine } from "@/lib/wholesale-cart";
import { useCart } from "./cart-context";
import { submitWholesaleRequest, markWhatsappShareOpened, type WholesaleRequestState } from "./actions";

type Step = "cart" | "form" | "review" | "success";

type FormValues = {
  first_name: string;
  last_name: string;
  company_name: string;
  cuit: string;
  instagram: string;
  website: string;
  city: string;
  province: string;
  address: string;
  postal_code: string;
  whatsapp: string;
  email: string;
  notes: string;
};

const EMPTY_FORM_VALUES: FormValues = {
  first_name: "",
  last_name: "",
  company_name: "",
  cuit: "",
  instagram: "",
  website: "",
  city: "",
  province: "",
  address: "",
  postal_code: "",
  whatsapp: "",
  email: "",
  notes: "",
};

// Client-side mirror of schemas/wholesale.ts's required fields — never
// authoritative (the server/RPC decide for real), just enough to catch an
// obviously-missing field before advancing to the review step, same spirit
// as lib/wholesale-cart.ts's minimum checks.
const REQUIRED_FIELD_LABELS: Partial<Record<keyof FormValues, string>> = {
  first_name: "el nombre",
  last_name: "el apellido",
  whatsapp: "el WhatsApp",
  email: "el email",
  company_name: "la razón social o el nombre del comercio",
  city: "la ciudad",
  province: "la provincia",
};

function firstMissingRequiredField(values: FormValues): string | null {
  for (const [field, label] of Object.entries(REQUIRED_FIELD_LABELS)) {
    if (!values[field as keyof FormValues].trim()) return label;
  }
  return null;
}

function buildWhatsappMessage(input: {
  humanCode: string;
  buyerName: string;
  companyName: string;
  totalUnits: number;
  totalAmount: number;
  documentUrl: string | null;
}): string {
  const lines = [
    "Hola Juli! 👋",
    "Acabo de enviar una solicitud mayorista desde el catálogo de Pottery.",
    "",
    `Pedido: ${input.humanCode}`,
    "",
    `Nombre: ${input.buyerName}`,
  ];
  if (input.companyName) lines.push(`Comercio: ${input.companyName}`);
  lines.push("", `${input.totalUnits} piezas`, `Total estimado: ${formatCurrency(input.totalAmount)}`);
  if (input.documentUrl) {
    lines.push("", "Te comparto el resumen del pedido:", input.documentUrl);
  }
  lines.push("", "Quedo a la espera de tu confirmación.");
  return lines.join("\n");
}

export function CartSheet({
  products,
  settings,
}: {
  products: WholesaleProduct[];
  settings: WholesaleSettingsPublic | null;
}) {
  const { cart, setQuantity, totalItemCount, clear } = useCart();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("cart");
  // One id per checkout attempt — reused across retries (a failed submit,
  // a timeout, a double click) so the server can recognize "this is the
  // same request again" and never create a second order for it. Only
  // rotates once a checkout actually succeeds and the cart is cleared for
  // a genuinely new one (sección 10).
  const [requestId, setRequestId] = useState<string>(() => crypto.randomUUID());
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM_VALUES);
  const [formError, setFormError] = useState<string | null>(null);
  const [showSummaryInSuccess, setShowSummaryInSuccess] = useState(false);
  const [state, formAction, isPending] = useActionState<WholesaleRequestState, FormData>(
    submitWholesaleRequest,
    {}
  );

  const updateField = (field: keyof FormValues) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormValues((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const lines = useMemo(() => {
    const variantIndex = new Map(
      products.flatMap((p) => p.variants.map((v) => [v.id, { product: p, variant: v }]))
    );
    return Object.entries(cart)
      .map(([variantId, quantity]) => {
        const entry = variantIndex.get(variantId);
        if (!entry) return null;
        return { ...entry, quantity };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
  }, [cart, products]);

  const cartLines: CartLine[] = useMemo(
    () =>
      lines.map((l) => ({
        key: l.variant.id,
        productName: l.product.name,
        quantity: l.quantity,
        unitPrice: l.variant.unitPrice,
        minQuantity: l.product.minQuantity,
        multipleOf: l.product.multipleOf,
      })),
    [lines]
  );
  const validation = validateWholesaleCart(cartLines, settings);
  const {
    totalAmount,
    totalUnits,
    missingAmount,
    missingUnits,
    belowProductMinimums,
    wrongMultiples,
    canSubmit,
  } = validation;

  if (state.humanCode && step !== "success") setStep("success");

  const buyerName = [formValues.first_name, formValues.last_name].filter(Boolean).join(" ");
  const whatsappMessage = state.humanCode
    ? buildWhatsappMessage({
        humanCode: state.humanCode,
        buyerName,
        companyName: formValues.company_name,
        totalUnits,
        totalAmount,
        documentUrl: state.documentUrl ?? null,
      })
    : "";
  const canShareViaWebShare = typeof navigator !== "undefined" && "share" in navigator;

  function resetForNewOrder() {
    clear();
    setRequestId(crypto.randomUUID());
    setFormValues(EMPTY_FORM_VALUES);
    setShowSummaryInSuccess(false);
    setStep("cart");
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && step === "success") resetForNewOrder();
      }}
    >
      <SheetTrigger
        render={
          <Button className="fixed bottom-4 left-1/2 z-40 h-12 w-[calc(100%-2rem)] max-w-[44rem] -translate-x-1/2 gap-2 shadow-lg" />
        }
      >
        <ShoppingCart className="size-4" />
        {totalItemCount > 0 ? `Ver carrito (${totalItemCount})` : "Ver carrito"}
      </SheetTrigger>

      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        {step === "cart" && (
          <>
            <SheetHeader>
              <SheetTitle>Tu pedido</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-3 px-4">
              {lines.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Todavía no agregaste productos.
                </p>
              ) : (
                lines.map((l) => (
                  <div key={l.variant.id} className="flex items-center justify-between gap-2 text-sm">
                    <div>
                      <p className="font-medium">
                        {l.product.name}
                        {l.variant.name !== "Único" && ` — ${l.variant.name}`}
                      </p>
                      <p className="text-muted-foreground">
                        {formatCurrency(l.variant.unitPrice)} × {l.quantity} ={" "}
                        {formatCurrency(l.variant.unitPrice * l.quantity)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() =>
                          setQuantity(l.variant.id, Math.max(0, l.quantity - (l.product.multipleOf ?? 1)))
                        }
                      >
                        −
                      </Button>
                      <span className="w-6 text-center">{l.quantity}</span>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() =>
                          setQuantity(l.variant.id, l.quantity + (l.product.multipleOf ?? 1))
                        }
                      >
                        +
                      </Button>
                    </div>
                  </div>
                ))
              )}

              {lines.length > 0 && (
                <div className="flex flex-col gap-1 border-t pt-3 text-sm">
                  <div className="flex justify-between font-medium">
                    <span>Total piezas</span>
                    <span>{totalUnits}</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Subtotal</span>
                    <span>{formatCurrency(totalAmount)}</span>
                  </div>
                </div>
              )}

              {missingAmount > 0 && (
                <p className="text-sm text-amber-600">
                  Te faltan {formatCurrency(missingAmount)} para alcanzar el mínimo mayorista.
                </p>
              )}
              {missingUnits > 0 && (
                <p className="text-sm text-amber-600">
                  Te faltan {missingUnits} piezas para alcanzar el mínimo de {settings?.min_total_units}.
                </p>
              )}
              {belowProductMinimums.map((l) => (
                <p key={l.key} className="text-sm text-amber-600">
                  La cantidad mínima de {l.productName} es {l.minQuantity}.
                </p>
              ))}
              {wrongMultiples.map((l) => (
                <p key={l.key} className="text-sm text-amber-600">
                  {l.productName} se pide en múltiplos de {l.multipleOf}.
                </p>
              ))}
            </div>
            <SheetFooter>
              <Button disabled={!canSubmit} onClick={() => setStep("form")}>
                Continuar
              </Button>
            </SheetFooter>
          </>
        )}

        {step === "form" && (
          <>
            <SheetHeader>
              <SheetTitle>Tus datos</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-4">
              <div>
                <h3 className="mb-2 text-sm font-medium">Persona de contacto</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="first_name">Nombre *</Label>
                    <Input id="first_name" value={formValues.first_name} onChange={updateField("first_name")} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="last_name">Apellido *</Label>
                    <Input id="last_name" value={formValues.last_name} onChange={updateField("last_name")} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="whatsapp">WhatsApp *</Label>
                    <Input id="whatsapp" value={formValues.whatsapp} onChange={updateField("whatsapp")} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="email">Email *</Label>
                    <Input id="email" type="email" value={formValues.email} onChange={updateField("email")} required />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Datos comerciales</h3>
                <div className="flex flex-col gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="company_name">Razón social / Nombre del comercio *</Label>
                    <Input id="company_name" value={formValues.company_name} onChange={updateField("company_name")} required />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="cuit">CUIT</Label>
                      <Input id="cuit" value={formValues.cuit} onChange={updateField("cuit")} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="instagram">Instagram</Label>
                      <Input id="instagram" value={formValues.instagram} onChange={updateField("instagram")} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="website">Sitio web</Label>
                    <Input id="website" type="url" placeholder="https://..." value={formValues.website} onChange={updateField("website")} />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Ubicación</h3>
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="city">Ciudad *</Label>
                      <Input id="city" value={formValues.city} onChange={updateField("city")} required />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="province">Provincia *</Label>
                      <Input id="province" value={formValues.province} onChange={updateField("province")} required />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="address">Dirección</Label>
                      <Input id="address" value={formValues.address} onChange={updateField("address")} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="postal_code">Código postal</Label>
                      <Input id="postal_code" value={formValues.postal_code} onChange={updateField("postal_code")} />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Información adicional</h3>
                <div className="space-y-1">
                  <Label htmlFor="notes">Observaciones</Label>
                  <Textarea id="notes" rows={2} value={formValues.notes} onChange={updateField("notes")} />
                </div>
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <Button
                onClick={() => {
                  const missing = firstMissingRequiredField(formValues);
                  if (missing) {
                    setFormError(`Falta ${missing}.`);
                    return;
                  }
                  setFormError(null);
                  setStep("review");
                }}
              >
                Revisar pedido
              </Button>
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <SheetHeader>
              <SheetTitle>Revisá tu pedido</SheetTitle>
            </SheetHeader>
            <form action={formAction} className="flex flex-col gap-4 px-4 pb-4">
              <input
                type="hidden"
                name="items"
                value={JSON.stringify(
                  lines.map((l) => ({ product_variant_id: l.variant.id, quantity: l.quantity }))
                )}
              />
              <input type="hidden" name="client_request_id" value={requestId} />
              {Object.entries(formValues).map(([field, value]) => (
                <input key={field} type="hidden" name={field} value={value} />
              ))}

              <div className="text-sm">
                <h3 className="mb-1 font-medium">Comprador</h3>
                <p>{buyerName}</p>
                {formValues.company_name && <p className="text-muted-foreground">{formValues.company_name}</p>}
                {(formValues.city || formValues.province) && (
                  <p className="text-muted-foreground">
                    {[formValues.city, formValues.province].filter(Boolean).join(", ")}
                  </p>
                )}
                <p className="text-muted-foreground">{formValues.whatsapp}</p>
                <p className="text-muted-foreground">{formValues.email}</p>
              </div>

              <div className="text-sm">
                <h3 className="mb-1 font-medium">Productos</h3>
                <div className="flex flex-col gap-1">
                  {lines.map((l) => (
                    <div key={l.variant.id} className="flex justify-between">
                      <span>
                        {l.quantity} × {l.product.name}
                        {l.variant.name !== "Único" && ` (${l.variant.name})`}
                      </span>
                      <span>{formatCurrency(l.variant.unitPrice * l.quantity)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t pt-2 text-sm">
                <div className="flex justify-between font-medium">
                  <span>Piezas</span>
                  <span>{totalUnits}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Total</span>
                  <span>{formatCurrency(totalAmount)}</span>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                <h3 className="mb-1 font-medium text-foreground">Condiciones</h3>
                <p>Pedido mínimo: {canSubmit ? "Cumplido" : "—"}</p>
                {(settings?.lead_time_min_days || settings?.lead_time_max_days) && (
                  <p>
                    Producción estimada: {settings?.lead_time_min_days}–{settings?.lead_time_max_days} días
                  </p>
                )}
                {settings?.payment_terms && <p>Forma de pago: {settings.payment_terms}</p>}
                {settings?.shipping_terms && <p>Envío: {settings.shipping_terms}</p>}
              </div>

              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setStep("form")}>
                  Editar datos
                </Button>
                <Button type="button" variant="outline" className="flex-1" onClick={() => setStep("cart")}>
                  Editar carrito
                </Button>
              </div>

              {state.error && <p className="text-sm text-destructive">{state.error}</p>}
              <Button type="submit" disabled={isPending}>
                {isPending ? "Enviando..." : "Enviar solicitud de pedido"}
              </Button>
            </form>
          </>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <SheetHeader>
              <SheetTitle>¡Recibimos tu solicitud!</SheetTitle>
            </SheetHeader>
            <p className="text-sm">
              Pedido <span className="font-medium">{state.humanCode}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              {totalUnits} piezas · Total estimado: {formatCurrency(totalAmount)}
            </p>
            <p className="text-sm font-medium text-amber-600">
              Tu pedido todavía debe ser confirmado por Pottery.
            </p>

            {settings?.business_whatsapp && (
              <Button
                className="w-full gap-2"
                render={
                  <a
                    href={whatsappLink(settings.business_whatsapp, whatsappMessage)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      if (state.orderId) markWhatsappShareOpened(state.orderId).catch(() => {});
                    }}
                  />
                }
              >
                Enviar pedido por WhatsApp
              </Button>
            )}

            <div className="flex w-full gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowSummaryInSuccess((v) => !v)}>
                {showSummaryInSuccess ? "Ocultar resumen" : "Ver resumen"}
              </Button>
              {state.documentUrl && (
                <Button
                  variant="outline"
                  className="flex-1"
                  render={<a href={state.documentUrl} target="_blank" rel="noreferrer" />}
                >
                  Descargar PDF
                </Button>
              )}
            </div>

            {canShareViaWebShare && state.documentUrl && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  navigator
                    .share({ title: `Pedido ${state.humanCode}`, text: whatsappMessage, url: state.documentUrl ?? undefined })
                    .catch(() => {});
                }}
              >
                Compartir resumen
              </Button>
            )}

            {showSummaryInSuccess && (
              <div className="w-full space-y-1 rounded-md border p-3 text-left text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{buyerName}</p>
                {formValues.company_name && <p>{formValues.company_name}</p>}
                {(formValues.city || formValues.province) && (
                  <p>{[formValues.city, formValues.province].filter(Boolean).join(", ")}</p>
                )}
                {lines.map((l) => (
                  <p key={l.variant.id}>
                    {l.quantity} × {l.product.name}
                    {l.variant.name !== "Único" && ` (${l.variant.name})`}
                  </p>
                ))}
              </div>
            )}

            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                resetForNewOrder();
              }}
            >
              Cerrar
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
