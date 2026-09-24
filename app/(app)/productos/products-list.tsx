"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProductRow } from "./product-row";
import { SelectionProvider } from "./selection-context";
import { BulkPriceBar, type ProductVariantForBulk } from "./bulk-price-bar";
import { BulkDeleteBar } from "./bulk-delete-bar";
import { SelectAllCheckbox } from "./select-all-checkbox";
import { loadMoreProducts } from "./actions";
import type {
  ProductListRow,
  PriceByVariant,
  ProductsPageCursor,
  ProductStatusFilter,
} from "@/lib/products";

/**
 * Dueña de la paginación de /productos (perf audit H-08 bloque 4).
 * A diferencia de /pedidos y /ventas, acá "Cargar más" NO navega — hace
 * un append en memoria sobre este estado (products/prices/cursor), para
 * que la selección masiva (SelectionProvider de acá abajo) sobreviva
 * entre tandas. El componente entero se remonta (vía `key` en page.tsx)
 * cuando cambia `status` o `search`, lo que reinicia esta paginación Y
 * la selección a la vez — así "una acción masiva nunca afecta elementos
 * que la usuaria no sabe que siguen seleccionados" sale gratis: no hay
 * forma de que quede seleccionado un producto que ya no está en pantalla.
 */
export function ProductsList({
  initialProducts,
  initialPrices,
  initialCursor,
  status,
  search,
  emptyMessage,
  canEdit,
  canDelete,
}: {
  initialProducts: ProductListRow[];
  initialPrices: PriceByVariant;
  initialCursor: ProductsPageCursor;
  status: ProductStatusFilter;
  search: string;
  emptyMessage: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [products, setProducts] = useState(initialProducts);
  const [prices, setPrices] = useState(initialPrices);
  const [cursor, setCursor] = useState(initialCursor);
  const [isPending, startTransition] = useTransition();

  function handleLoadMore() {
    startTransition(async () => {
      const page = await loadMoreProducts(status, search, cursor);
      setProducts((prev) => [...prev, ...page.products]);
      setPrices((prev) => ({ ...prev, ...page.prices }));
      setCursor(page.nextCursor);
    });
  }

  const variantsForBulk: ProductVariantForBulk[] = useMemo(
    () =>
      products.flatMap((product) =>
        product.product_variants.map((v) => ({
          variantId: v.id,
          productId: product.id,
          label: product.product_variants.length > 1 ? `${product.name} — ${v.name}` : product.name,
          retail: prices[v.id]?.retail ?? null,
          wholesale: prices[v.id]?.wholesale ?? null,
        }))
      ),
    [products, prices]
  );

  return (
    <SelectionProvider>
      <div className="flex flex-col gap-4">
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <BulkPriceBar variants={variantsForBulk} />
            <BulkDeleteBar canDelete={canDelete} />
          </div>
        )}

        {products.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {canEdit && (
                  <TableHead className="w-8">
                    <SelectAllCheckbox ids={products.map((p) => p.id)} />
                  </TableHead>
                )}
                <TableHead>Producto</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Precio minorista</TableHead>
                <TableHead>Precio mayorista</TableHead>
                <TableHead>Estado</TableHead>
                {canEdit && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => {
                const variantIds = product.product_variants.map((v) => v.id);
                const retailPrices = variantIds
                  .map((id) => prices[id]?.retail)
                  .filter((v): v is number => v != null);
                const wholesalePrices = variantIds
                  .map((id) => prices[id]?.wholesale)
                  .filter((v): v is number => v != null);

                return (
                  <ProductRow
                    key={product.id}
                    id={product.id}
                    name={product.name}
                    categoryName={product.product_categories?.name ?? null}
                    variantCount={product.product_variants.length}
                    retailPrice={retailPrices.length ? Math.min(...retailPrices) : null}
                    wholesalePrice={
                      wholesalePrices.length ? Math.min(...wholesalePrices) : null
                    }
                    isActive={product.is_active}
                    canEdit={canEdit}
                    canDelete={canDelete}
                  />
                );
              })}
            </TableBody>
          </Table>
        )}

        {cursor && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={handleLoadMore} disabled={isPending}>
              {isPending ? "Cargando..." : "Cargar más"}
            </Button>
          </div>
        )}
      </div>
    </SelectionProvider>
  );
}
