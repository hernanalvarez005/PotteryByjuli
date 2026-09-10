"use client";

import { useActionState, useMemo, useState } from "react";
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
import type { WholesaleProduct, WholesaleSettingsPublic } from "@/lib/wholesale";
import { validateWholesaleCart, type CartLine } from "@/lib/wholesale-cart";
import { useCart } from "./cart-context";
import { submitWholesaleRequest, type WholesaleRequestState } from "./actions";

type Step = "cart" | "form" | "success";

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
  const [state, formAction, isPending] = useActionState<WholesaleRequestState, FormData>(
    submitWholesaleRequest,
    {}
  );

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

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && step === "success") {
          clear();
          setRequestId(crypto.randomUUID());
          setStep("cart");
        }
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
            <form action={formAction} className="flex flex-col gap-3 px-4 pb-4">
              <input
                type="hidden"
                name="items"
                value={JSON.stringify(
                  lines.map((l) => ({ product_variant_id: l.variant.id, quantity: l.quantity }))
                )}
              />
              <input type="hidden" name="client_request_id" value={requestId} />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="first_name">Nombre</Label>
                  <Input id="first_name" name="first_name" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="last_name">Apellido</Label>
                  <Input id="last_name" name="last_name" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="company_name">Comercio</Label>
                <Input id="company_name" name="company_name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="whatsapp">WhatsApp</Label>
                  <Input id="whatsapp" name="whatsapp" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="city">Ciudad</Label>
                  <Input id="city" name="city" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="province">Provincia</Label>
                  <Input id="province" name="province" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="instagram">Instagram</Label>
                  <Input id="instagram" name="instagram" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cuit">CUIT</Label>
                  <Input id="cuit" name="cuit" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="website">Web (opcional)</Label>
                <Input id="website" name="website" type="url" placeholder="https://..." />
              </div>
              <div className="space-y-1">
                <Label htmlFor="notes">Observaciones</Label>
                <Textarea id="notes" name="notes" rows={2} />
              </div>
              {state.error && <p className="text-sm text-destructive">{state.error}</p>}
              <Button type="submit" disabled={isPending}>
                {isPending ? "Enviando..." : "Enviar solicitud"}
              </Button>
            </form>
          </>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <SheetHeader>
              <SheetTitle>¡Listo!</SheetTitle>
            </SheetHeader>
            <p className="text-sm text-muted-foreground">
              Recibimos tu solicitud <span className="font-medium text-foreground">{state.humanCode}</span>.
              Te vamos a contactar por WhatsApp para confirmar disponibilidad y coordinar el pago.
            </p>
            <Button
              onClick={() => {
                setOpen(false);
                clear();
                setRequestId(crypto.randomUUID());
                setStep("cart");
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
