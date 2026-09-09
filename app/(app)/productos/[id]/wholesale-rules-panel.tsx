"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { upsertWholesaleRules } from "./actions";

export type WholesaleRules = {
  is_public: boolean;
  min_quantity: number | null;
  multiple_of: number | null;
  lead_time_days: number | null;
} | null;

export function WholesaleRulesPanel({
  productId,
  rules,
  hasWholesalePrice,
  canEdit,
}: {
  productId: string;
  rules: WholesaleRules;
  hasWholesalePrice: boolean;
  canEdit: boolean;
}) {
  const boundAction = upsertWholesaleRules.bind(null, productId);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Catálogo mayorista</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasWholesalePrice && (
          <p className="mb-4 text-sm text-amber-600">
            Este producto todavía no tiene precio mayorista — no puede
            publicarse hasta que le pongas uno en la pestaña de Precios.
          </p>
        )}
        <fieldset disabled={!canEdit} className="contents">
          <form action={formAction} className="flex flex-col gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="is_public"
                defaultChecked={rules?.is_public ?? false}
                className="size-4"
              />
              Visible en el catálogo mayorista público
            </label>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="min_quantity">Mínimo (unidades)</Label>
                <Input
                  id="min_quantity"
                  name="min_quantity"
                  type="number"
                  min="1"
                  defaultValue={rules?.min_quantity ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="multiple_of">Múltiplo de</Label>
                <Input
                  id="multiple_of"
                  name="multiple_of"
                  type="number"
                  min="1"
                  defaultValue={rules?.multiple_of ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lead_time_days">Plazo (días)</Label>
                <Input
                  id="lead_time_days"
                  name="lead_time_days"
                  type="number"
                  min="1"
                  defaultValue={rules?.lead_time_days ?? ""}
                />
              </div>
            </div>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            {canEdit && (
              <Button type="submit" disabled={isPending} className="self-start">
                {isPending ? "Guardando..." : "Guardar"}
              </Button>
            )}
          </form>
        </fieldset>
      </CardContent>
    </Card>
  );
}
