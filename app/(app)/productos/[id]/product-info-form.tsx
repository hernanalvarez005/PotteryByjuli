"use client";

import { useActionState } from "react";
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
import { updateProduct } from "./actions";

export function ProductInfoForm({
  productId,
  name,
  categoryId,
  description,
  costEstimate,
  categories,
  canEdit,
}: {
  productId: string;
  name: string;
  categoryId: string | null;
  description: string | null;
  costEstimate: number | null;
  categories: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const boundAction = updateProduct.bind(null, productId);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Datos generales</CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit} className="contents">
          <form action={formAction} className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" name="name" defaultValue={name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category_id">Categoría</Label>
              <Select name="category_id" defaultValue={categoryId ?? undefined}>
                <SelectTrigger id="category_id" className="w-full">
                  <SelectValue placeholder="Sin categoría" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={description ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost_estimate">Costo estimado (ARS)</Label>
              <Input
                id="cost_estimate"
                name="cost_estimate"
                type="number"
                min="0"
                step="0.01"
                defaultValue={costEstimate ?? ""}
              />
            </div>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            {canEdit && (
              <Button type="submit" disabled={isPending} className="self-start">
                {isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            )}
          </form>
        </fieldset>
      </CardContent>
    </Card>
  );
}
