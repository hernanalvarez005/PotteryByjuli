import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner } from "@/lib/auth";
import { getProductsWithVariants } from "@/lib/products";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PriceCell } from "./price-cell";

export default async function PreciosPage() {
  const user = await requireUser();
  const canEdit = isOwner(user);

  const supabase = await createClient();
  const [{ data: priceLists }, products] = await Promise.all([
    supabase.from("price_lists").select("id,code,name").order("name"),
    getProductsWithVariants(),
  ]);

  const activeProducts = products.filter((p) => p.is_active);
  const variantIds = activeProducts.flatMap((p) => p.product_variants.map((v) => v.id));

  const { data: priceRows } = variantIds.length
    ? await supabase
        .from("price_list_items")
        .select("price_list_id,product_variant_id,unit_price")
        .in("product_variant_id", variantIds)
    : { data: [] as { price_list_id: string; product_variant_id: string; unit_price: number }[] };

  const prices: Record<string, number> = {};
  for (const row of priceRows ?? []) {
    prices[`${row.price_list_id}:${row.product_variant_id}`] = row.unit_price;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Precios</h1>
        <p className="text-muted-foreground">
          Cambiá un precio acá y se actualiza en todo el sistema — nunca
          reescribe pedidos ya hechos, esos guardan el precio del momento.
        </p>
      </div>

      {activeProducts.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay productos activos.{" "}
          <Link href="/productos" className="underline underline-offset-2">
            Cargar el primero
          </Link>
          .
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>Variante</TableHead>
              {(priceLists ?? []).map((pl) => (
                <TableHead key={pl.id}>{pl.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeProducts.flatMap((product) =>
              product.product_variants
                .filter((v) => v.is_active)
                .map((variant) => (
                  <TableRow key={variant.id}>
                    <TableCell className="text-muted-foreground">{product.name}</TableCell>
                    <TableCell className="font-medium">{variant.name}</TableCell>
                    {(priceLists ?? []).map((pl) => (
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
      )}
    </div>
  );
}
