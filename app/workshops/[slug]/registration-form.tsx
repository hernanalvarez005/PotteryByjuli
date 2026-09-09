"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Copy, Check } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import type { PublicWorkshop } from "@/lib/workshops-public";
import { submitWorkshopRegistration } from "./actions";

export function RegistrationForm({ workshop }: { workshop: PublicWorkshop }) {
  const boundAction = submitWorkshopRegistration.bind(null, workshop.id);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  if (state.result) {
    return <ConfirmationScreen workshop={workshop} result={state.result} />;
  }

  const spotsLeft = workshop.capacity != null ? workshop.capacity - workshop.confirmedCount : null;
  const isFull = spotsLeft != null && spotsLeft <= 0;
  const canRegister = workshop.is_registration_open && workshop.status !== "full" && !isFull;

  if (!canRegister) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-center">
        <p className="font-medium">Cupo completo</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ya no hay lugares disponibles para este workshop. Escribinos si querés que te avisemos ante
          una vacante.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <p className="font-medium">Anotate</p>
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
        <Label htmlFor="whatsapp">WhatsApp</Label>
        <Input id="whatsapp" name="whatsapp" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Email (opcional)</Label>
        <Input id="email" name="email" type="email" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="participant_name">
          Nombre del/la participante <span className="text-muted-foreground">(si no sos vos, ej. workshops para niños)</span>
        </Label>
        <Input id="participant_name" name="participant_name" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Comentarios (opcional)</Label>
        <Textarea id="notes" name="notes" rows={2} />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={isPending} className="mt-1">
        {isPending ? "Enviando..." : "Confirmar inscripción"}
      </Button>
    </form>
  );
}

function ConfirmationScreen({
  workshop,
  result,
}: {
  workshop: PublicWorkshop;
  result: NonNullable<import("./actions").WorkshopRegistrationState["result"]>;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-secondary/40 p-4 text-center">
      <p className="text-lg font-semibold">¡Tu lugar fue registrado!</p>
      <div className="text-left text-sm">
        <Row label="Workshop" value={result.event_name} />
        <Row label="Fecha" value={formatDate(result.event_date)} />
        {result.price != null && <Row label="Precio" value={formatCurrency(result.price)} />}
      </div>

      {workshop.paymentAccount?.alias && (
        <div className="mt-2 rounded-md border border-border bg-card p-3 text-left">
          <p className="text-xs text-muted-foreground">Transferencia — Alias</p>
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">{workshop.paymentAccount.alias}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(workshop.paymentAccount!.alias!).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copiado" : "Copiar alias"}
            </Button>
          </div>
          {workshop.paymentAccount.holder_name && (
            <p className="mt-1 text-xs text-muted-foreground">Titular: {workshop.paymentAccount.holder_name}</p>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Todavía no está pagado — esto sólo registra tu lugar. Te contactamos por WhatsApp para
        coordinar.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border/60 py-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
