import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner } from "@/lib/auth";
import { getProductsPage, getAllListPricesForVariants } from "@/lib/products";
import { PriceConditionManager } from "./price-condition-manager";
import { PricesList } from "./prices-list";
import { PricesSearch } from "./prices-search";

export default async function PreciosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const canEdit = isOwner(user);
  const { q } = await searchParams;
  const search = q ?? "";

  const supabase = await createClient();
  // El catálogo se pagina + busca server-side acá (perf audit H-08
  // bloque 5) — con 3.352 productos activos, la query sin acotar de
  // antes ya rompía con HTTP 414 al resolver precios (confirmado por
  // medición). getProductsPage() es la misma paginación/búsqueda que
  // /productos — nunca una segunda arquitectura de catálogo.
  const [{ data: priceLists }, firstPage, { data: conditionRows }, { data: allMethods }] = await Promise.all([
    supabase.from("price_lists").select("id,code,name").order("name"),
    getProductsPage("active", search, null),
    supabase
      .from("price_conditions")
      .select("id,code,name,is_active,price_condition_payment_methods(payment_methods(id,name))")
      .order("sort_order")
      .order("name"),
    supabase.from("payment_methods").select("id,name").eq("is_active", true).order("sort_order"),
  ]);

  const conditions = (conditionRows ?? []).map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    is_active: c.is_active,
    methods: (c.price_condition_payment_methods as unknown as { payment_methods: { id: string; name: string } | null }[])
      .map((link) => link.payment_methods)
      .filter((m): m is { id: string; name: string } => m !== null),
  }));

  const firstPageVariantIds = firstPage.products.flatMap((p) => p.product_variants.map((v) => v.id));
  const prices = await getAllListPricesForVariants(firstPageVariantIds);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Precios</h1>
        <p className="text-muted-foreground">
          Cambiá un precio acá y se actualiza en todo el sistema — nunca
          reescribe pedidos ya hechos, esos guardan el precio del momento.
        </p>
      </div>

      {canEdit && <PriceConditionManager conditions={conditions} allMethods={allMethods ?? []} />}

      <PricesSearch initialValue={search} />

      {firstPage.products.length === 0 && !search.trim() ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay productos activos.{" "}
          <Link href="/productos" className="underline underline-offset-2">
            Cargar el primero
          </Link>
          .
        </p>
      ) : (
        <PricesList
          key={search}
          initialProducts={firstPage.products}
          initialCursor={firstPage.nextCursor}
          initialPrices={prices}
          priceLists={priceLists ?? []}
          search={search}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
