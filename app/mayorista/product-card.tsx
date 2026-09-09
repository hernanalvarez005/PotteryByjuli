"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { WholesaleProduct } from "@/lib/wholesale";
import { useCart } from "./cart-context";

export function ProductCard({ product }: { product: WholesaleProduct }) {
  const { cart, setQuantity } = useCart();
  const [selectedVariantId, setSelectedVariantId] = useState(product.variants[0]?.id ?? "");
  const variant = product.variants.find((v) => v.id === selectedVariantId) ?? product.variants[0];
  const inCart = variant ? (cart[variant.id] ?? 0) : 0;

  if (!variant) return null;

  const step = product.multipleOf ?? 1;
  const min = product.minQuantity ?? step;

  return (
    <Card className="overflow-hidden py-0">
      <div className="relative aspect-square w-full bg-muted">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, 300px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Sin foto
          </div>
        )}
      </div>
      <CardContent className="flex flex-col gap-2 p-3">
        <div>
          <h3 className="text-sm font-medium leading-tight">{product.name}</h3>
          <p className="text-sm text-muted-foreground">{formatCurrency(variant.unitPrice)}</p>
        </div>

        {product.variants.length > 1 && (
          <Select value={selectedVariantId} onValueChange={(v) => v && setSelectedVariantId(v)}>
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {product.variants.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(product.minQuantity || product.multipleOf) && (
          <p className="text-[11px] text-muted-foreground">
            {product.minQuantity ? `Mín. ${product.minQuantity}` : ""}
            {product.minQuantity && product.multipleOf ? " · " : ""}
            {product.multipleOf ? `de a ${product.multipleOf}` : ""}
          </p>
        )}

        {inCart > 0 ? (
          <div className="flex items-center justify-between gap-2">
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() => setQuantity(variant.id, Math.max(0, inCart - step))}
            >
              −
            </Button>
            <span className="text-sm font-medium">{inCart}</span>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() => setQuantity(variant.id, inCart + step)}
            >
              +
            </Button>
          </div>
        ) : (
          <Button size="sm" className="w-full" onClick={() => setQuantity(variant.id, min)}>
            Agregar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
