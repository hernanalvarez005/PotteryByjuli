"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PriceCell } from "./price-cell";
import { loadMorePrices } from "./actions";
import type { ProductListRow, ProductsPageCursor } from "@/lib/products";

type PriceList = { id: string; name: string };

/**
 * Dueña de la paginación de /precios (perf audit H-08 bloque 5) — mismo
 * patrón que /productos/products-list.tsx: "Cargar más" hace append en
 * memoria (nunca navega). Acá no hay selección masiva que preservar,
 * pero el append evita perder las filas ya cargadas mientras se edita
 * un precio más abajo en la tabla.
 */
export function PricesList({
  initialProducts,
  initialCursor,
  initialPrices,
  priceLists,
  search,
  canEdit,
}: {
  initialProducts: ProductListRow[];
  initialCursor: ProductsPageCursor;
  initialPrices: Record<string, number>;
  priceLists: PriceList[];
  search: string;
  canEdit: boolean;
}) {
  const [products, setProducts] = useState(initialProducts);
  const [prices, setPrices] = useState(initialPrices);
  const [cursor, setCursor] = useState(initialCursor);
  const [isPending, startTransition] = useTransition();

  function handleLoadMore() {
    startTransition(async () => {
      const page = await loadMorePrices("active", search, cursor);
      setProducts((prev) => [...prev, ...page.products]);
      setPrices((prev) => ({ ...prev, ...page.prices }));
      setCursor(page.nextCursor);
    });
  }

  if (products.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        {search.trim() ? `Sin resultados para "${search.trim()}".` : "Todavía no hay productos activos."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Producto</TableHead>
            <TableHead>Variante</TableHead>
            {priceLists.map((pl) => (
              <TableHead key={pl.id}>{pl.name}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.flatMap((product) =>
            product.product_variants
              .filter((v) => v.is_active)
              .map((variant) => (
                <TableRow key={variant.id}>
                  <TableCell className="text-muted-foreground">{product.name}</TableCell>
                  <TableCell className="font-medium">{variant.name}</TableCell>
                  {priceLists.map((pl) => (
                    <TableCell key={pl.id}>
                      <PriceCell
                        priceListId={pl.id}
                        variantId={variant.id}
                        currentPrice={prices[`${pl.id}:${variant.id}`]}
                        canEdit={canEdit}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
          )}
        </TableBody>
      </Table>

      {cursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={handleLoadMore} disabled={isPending}>
            {isPending ? "Cargando..." : "Cargar más"}
          </Button>
        </div>
      )}
    </div>
  );
}
