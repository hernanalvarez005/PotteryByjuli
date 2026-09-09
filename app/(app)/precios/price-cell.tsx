"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { upsertPrice } from "./actions";

export function PriceCell({
  priceListId,
  variantId,
  currentPrice,
  canEdit,
}: {
  priceListId: string;
  variantId: string;
  currentPrice: number | undefined;
  canEdit: boolean;
}) {
  const [state, formAction, isPending] = useActionState(upsertPrice, {});

  if (!canEdit) {
    return (
      <span className="text-sm">
        {currentPrice != null ? `$ ${currentPrice.toLocaleString("es-AR")}` : "—"}
      </span>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="price_list_id" value={priceListId} />
      <input type="hidden" name="product_variant_id" value={variantId} />
      <Input
        name="unit_price"
        type="number"
        min="0"
        step="0.01"
        defaultValue={currentPrice ?? ""}
        placeholder="Sin definir"
        className="h-8 w-28"
      />
      <Button type="submit" size="sm" variant="ghost" disabled={isPending}>
        {isPending ? "..." : "OK"}
      </Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
