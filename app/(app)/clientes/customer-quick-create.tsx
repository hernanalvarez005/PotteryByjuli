"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCustomer, findCustomerMatches, type CustomerMatch } from "./actions";

const MATCH_LABELS: Record<CustomerMatch["matchedBy"][number], string> = {
  whatsapp: "mismo WhatsApp",
  email: "mismo email",
  name: "nombre parecido",
};

/**
 * Alta rápida de cliente con búsqueda de coincidencias previa (sección 1/2
 * de la tanda de usabilidad) — nunca crea ni fusiona nada sola: busca
 * primero, muestra los candidatos y deja que la usuaria elija "Usar este
 * cliente" (nunca toca la base) o "Crear igualmente" (crea uno nuevo a
 * pesar del posible duplicado). Componente compartido — se usa desde
 * /pedidos/nuevo, "+ Asociar cliente" en la ficha de pedido, y el picker
 * de cliente de la venta rápida, para no repetir esta lógica tres veces.
 */
export function CustomerQuickCreate({
  onCreated,
  onCancel,
}: {
  onCreated: (customerId: string, label: string) => void;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState<"form" | "matches">("form");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function currentFormData() {
    const fd = new FormData();
    fd.set("first_name", firstName);
    fd.set("last_name", lastName);
    fd.set("whatsapp", whatsapp);
    fd.set("email", email);
    return fd;
  }

  async function actuallyCreate() {
    const { customerId, error: createError } = await createCustomer({}, currentFormData());
    if (createError || !customerId) {
      setError(createError ?? "No se pudo crear el cliente.");
      return;
    }
    onCreated(customerId, [firstName, lastName].filter(Boolean).join(" "));
  }

  function handleSearchThenCreate() {
    setError(undefined);
    if (!firstName.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    startTransition(async () => {
      const found = await findCustomerMatches(currentFormData());
      if (found.length > 0) {
        setMatches(found);
        setStep("matches");
      } else {
        await actuallyCreate();
      }
    });
  }

  function handleCreateAnyway() {
    setError(undefined);
    startTransition(actuallyCreate);
  }

  if (step === "matches") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium">Encontramos posibles coincidencias</p>
        <ul className="flex flex-col gap-2">
          {matches.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm">
              <div>
                <p className="font-medium">{m.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[m.whatsapp, m.email].filter(Boolean).join(" · ") || "—"} ·{" "}
                  {m.matchedBy.map((s) => MATCH_LABELS[s]).join(", ")}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => onCreated(m.id, m.name)}
              >
                Usar este cliente
              </Button>
            </li>
          ))}
        </ul>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={isPending} onClick={() => setStep("form")}>
            Volver
          </Button>
          <Button type="button" disabled={isPending} onClick={handleCreateAnyway}>
            {isPending ? "Creando..." : "Crear igualmente"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <Label htmlFor="qc_first_name">Nombre *</Label>
        <Input id="qc_first_name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="qc_last_name">Apellido</Label>
        <Input id="qc_last_name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="qc_whatsapp">WhatsApp</Label>
        <Input id="qc_whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="qc_email">Email</Label>
        <Input id="qc_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" disabled={isPending} onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="button" disabled={isPending || !firstName.trim()} onClick={handleSearchThenCreate}>
          {isPending ? "Buscando..." : "Crear cliente"}
        </Button>
      </div>
    </div>
  );
}
