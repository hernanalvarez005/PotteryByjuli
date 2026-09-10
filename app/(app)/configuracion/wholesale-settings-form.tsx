"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateWholesaleSettings } from "./actions";

export type WholesaleSettings = {
  id: string;
  min_order_amount: number | null;
  min_total_units: number | null;
  lead_time_min_days: number | null;
  lead_time_max_days: number | null;
  payment_terms: string | null;
  shipping_terms: string | null;
  commercial_message: string | null;
  business_whatsapp: string | null;
};

export function WholesaleSettingsForm({
  settings,
  canEdit,
}: {
  settings: WholesaleSettings;
  canEdit: boolean;
}) {
  const boundAction = updateWholesaleSettings.bind(null, settings.id);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  return (
    <fieldset disabled={!canEdit} className="contents">
      <form action={formAction} className="flex max-w-xl flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="min_order_amount">Pedido mínimo ($)</Label>
            <Input
              id="min_order_amount"
              name="min_order_amount"
              type="number"
              min="0"
              step="0.01"
              defaultValue={settings.min_order_amount ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="min_total_units">Mínimo de piezas</Label>
            <Input
              id="min_total_units"
              name="min_total_units"
              type="number"
              min="1"
              defaultValue={settings.min_total_units ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead_time_min_days">Plazo mínimo (días)</Label>
            <Input
              id="lead_time_min_days"
              name="lead_time_min_days"
              type="number"
              min="1"
              defaultValue={settings.lead_time_min_days ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead_time_max_days">Plazo máximo (días)</Label>
            <Input
              id="lead_time_max_days"
              name="lead_time_max_days"
              type="number"
              min="1"
              defaultValue={settings.lead_time_max_days ?? ""}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="payment_terms">Forma de pago</Label>
          <Textarea
            id="payment_terms"
            name="payment_terms"
            rows={2}
            defaultValue={settings.payment_terms ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="shipping_terms">Condiciones de envío</Label>
          <Textarea
            id="shipping_terms"
            name="shipping_terms"
            rows={2}
            defaultValue={settings.shipping_terms ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="commercial_message">Mensaje comercial (arriba del catálogo)</Label>
          <Textarea
            id="commercial_message"
            name="commercial_message"
            rows={3}
            defaultValue={settings.commercial_message ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="business_whatsapp">WhatsApp de Pottery</Label>
          <Input
            id="business_whatsapp"
            name="business_whatsapp"
            placeholder="11 2233-4455"
            defaultValue={settings.business_whatsapp ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Es el número al que el botón &quot;Enviar pedido por WhatsApp&quot; del catálogo público le
            escribe a la compradora. Si queda vacío, ese botón no se muestra.
          </p>
        </div>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {canEdit && (
          <Button type="submit" disabled={isPending} className="self-start">
            {isPending ? "Guardando..." : "Guardar condiciones"}
          </Button>
        )}
      </form>
    </fieldset>
  );
}
