"use client";

import { useActionState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { upsertPrice } from "./actions";
import { BulkWholesalePriceForm } from "./bulk-wholesale-price-form";

export type PriceList = { id: string; code: string; name: string };
export type Variant = { id: string; name: string };

export function PricesPanel({
  productId,
  variants,
  priceLists,
  prices,
  canEdit,
}: {
  productId: string;
  variants: Variant[];
  priceLists: PriceList[];
  /** `${priceListId}:${variantId}` -> precio actual */
  prices: Record<string, number>;
  canEdit: boolean;
}) {
  const wholesaleList = priceLists.find((pl) => pl.code === "wholesale");
  const wholesalePrices: Record<string, number | undefined> = {};
  if (wholesaleList) {
    for (const v of variants) {
      wholesalePrices[v.id] = prices[`${wholesaleList.id}:${v.id}`];
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Precios</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canEdit && wholesaleList && (
          <BulkWholesalePriceForm
            productId={productId}
            variants={variants}
            currentPrices={wholesalePrices}
          />
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variante</TableHead>
              {priceLists.map((pl) => (
                <TableHead key={pl.id}>{pl.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((variant) => (
              <TableRow key={variant.id}>
                <TableCell className="font-medium">{variant.name}</TableCell>
                {priceLists.map((pl) => (
                  <TableCell key={pl.id}>
                    <PriceCell
                      productId={productId}
                      priceListId={pl.id}
                      variantId={variant.id}
                      currentPrice={prices[`${pl.id}:${variant.id}`]}
                      canEdit={canEdit}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!canEdit && (
          <p className="pt-3 text-xs text-muted-foreground">
            Sólo la administradora puede modificar precios.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PriceCell({
  productId,
  priceListId,
  variantId,
  currentPrice,
  canEdit,
}: {
  productId: string;
  priceListId: string;
  variantId: string;
  currentPrice: number | undefined;
  canEdit: boolean;
}) {
  const boundAction = upsertPrice.bind(null, productId);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  if (!canEdit) {
    return currentPrice != null ? `$ ${currentPrice.toLocaleString("es-AR")}` : "—";
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
        {isPending ? "..." : "Guardar"}
      </Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
