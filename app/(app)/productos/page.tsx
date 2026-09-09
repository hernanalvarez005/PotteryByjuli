import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getProductsWithVariants, getPricesForVariants } from "@/lib/products";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NewProductDialog } from "./new-product-dialog";
import { ProductRow } from "./product-row";
import { SelectionProvider } from "./selection-context";
import { BulkPriceBar, type ProductVariantForBulk } from "./bulk-price-bar";
import { SelectAllCheckbox } from "./select-all-checkbox";

export default async function ProductosPage() {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");

  const supabase = await createClient();
  const [{ data: categories }, products] = await Promise.all([
    supabase.from("product_categories").select("id,name").order("name"),
    getProductsWithVariants(),
  ]);

  const allVariantIds = products.flatMap((p) => p.product_variants.map((v) => v.id));
  const prices = await getPricesForVariants(allVariantIds);

  const variantsForBulk: ProductVariantForBulk[] = products.flatMap((product) =>
    product.product_variants.map((v) => ({
      variantId: v.id,
      productId: product.id,
      label: product.product_variants.length > 1 ? `${product.name} — ${v.name}` : product.name,
      retail: prices[v.id]?.retail ?? null,
      wholesale: prices[v.id]?.wholesale ?? null,
    }))
  );

  return (
    <SelectionProvider>
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Productos</h1>
            <p className="text-muted-foreground">
              Un producto, sus variantes, y sus precios — la misma ficha para
              minorista y mayorista.
            </p>
          </div>
          {canEdit && <NewProductDialog categories={categories ?? []} />}
        </div>

        {canEdit && <BulkPriceBar variants={variantsForBulk} />}

        {products.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Todavía no cargaste ningún producto.
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
                  />
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </SelectionProvider>
  );
}
