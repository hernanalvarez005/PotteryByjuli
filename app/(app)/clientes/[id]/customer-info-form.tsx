"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateCustomer } from "../actions";

type Customer = {
  first_name: string;
  last_name: string | null;
  whatsapp: string | null;
  email: string | null;
  dni: string | null;
  cuit: string | null;
  company_name: string | null;
  instagram: string | null;
  website: string | null;
  city: string | null;
  province: string | null;
};

const FIELDS: { name: keyof Customer; label: string; type?: string }[] = [
  { name: "first_name", label: "Nombre" },
  { name: "last_name", label: "Apellido" },
  { name: "whatsapp", label: "WhatsApp" },
  { name: "email", label: "Email", type: "email" },
  { name: "company_name", label: "Comercio" },
  { name: "cuit", label: "CUIT" },
  { name: "dni", label: "DNI" },
  { name: "instagram", label: "Instagram" },
  { name: "website", label: "Web" },
  { name: "city", label: "Ciudad" },
  { name: "province", label: "Provincia" },
];

export function CustomerInfoForm({
  customerId,
  customer,
  canEdit,
}: {
  customerId: string;
  customer: Customer;
  canEdit: boolean;
}) {
  const boundAction = updateCustomer.bind(null, customerId);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Datos</CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit} className="contents">
          <form action={formAction} className="grid grid-cols-2 gap-4">
            {FIELDS.map((field) => (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={field.name}>{field.label}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type={field.type ?? "text"}
                  defaultValue={customer[field.name] ?? ""}
                  required={field.name === "first_name"}
                />
              </div>
            ))}
            {state.error && (
              <p className="col-span-2 text-sm text-destructive">{state.error}</p>
            )}
            {canEdit && (
              <Button type="submit" disabled={isPending} className="col-span-2 self-start">
                {isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            )}
          </form>
        </fieldset>
      </CardContent>
    </Card>
  );
}
