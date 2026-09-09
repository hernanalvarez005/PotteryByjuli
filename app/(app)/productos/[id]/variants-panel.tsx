"use client";

import { useActionState, useTransition } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createVariant, toggleVariantActive } from "./actions";

export type Variant = { id: string; name: string; sku: string | null; is_active: boolean };

export function VariantsPanel({
  productId,
  variants,
  canEdit,
}: {
  productId: string;
  variants: Variant[];
  canEdit: boolean;
}) {
  const boundCreate = createVariant.bind(null, productId);
  const [state, formAction, isPending] = useActionState(boundCreate, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Variantes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Estado</TableHead>
              {canEdit && <TableHead className="text-right">Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((v) => (
              <VariantRow key={v.id} productId={productId} variant={v} canEdit={canEdit} />
            ))}
          </TableBody>
        </Table>

        {canEdit && (
          <form action={formAction} className="flex items-end gap-2 border-t pt-4">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-muted-foreground">Nombre</label>
              <Input name="name" placeholder="Rosa" required />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs text-muted-foreground">SKU (opcional)</label>
              <Input name="sku" placeholder="TAZA-ROSA" />
            </div>
            <Button type="submit" variant="outline" disabled={isPending}>
              {isPending ? "Agregando..." : "Agregar variante"}
            </Button>
          </form>
        )}
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      </CardContent>
    </Card>
  );
}

function VariantRow({
  productId,
  variant,
  canEdit,
}: {
  productId: string;
  variant: Variant;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <TableRow>
      <TableCell>{variant.name}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {variant.sku ?? "—"}
      </TableCell>
      <TableCell>
        <Badge variant={variant.is_active ? "secondary" : "outline"}>
          {variant.is_active ? "Activa" : "Inactiva"}
        </Badge>
      </TableCell>
      {canEdit && (
        <TableCell className="text-right">
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() =>
              startTransition(() =>
                toggleVariantActive(productId, variant.id, !variant.is_active)
              )
            }
          >
            {variant.is_active ? "Desactivar" : "Activar"}
          </Button>
        </TableCell>
      )}
    </TableRow>
  );
}
