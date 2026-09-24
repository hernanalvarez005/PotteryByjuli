import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getProductsPage, type ProductStatusFilter } from "@/lib/products";
import { Badge } from "@/components/ui/badge";
import { NewProductDialog } from "./new-product-dialog";
import { ProductsList } from "./products-list";
import { ProductsSearch } from "./products-search";

const STATUS_FILTERS: { value: ProductStatusFilter; label: string }[] = [
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Inactivos" },
  { value: "all", label: "Todos" },
];

function statusFilterHref(status: ProductStatusFilter, search: string) {
  const params = new URLSearchParams();
  if (status !== "active") params.set("estado", status);
  if (search) params.set("q", search);
  const query = params.toString();
  return query ? `/productos?${query}` : "/productos";
}

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; q?: string }>;
}) {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");
  const canDelete = isOwner(user);

  const { estado, q } = await searchParams;
  const status: ProductStatusFilter =
    estado === "inactive" || estado === "all" ? estado : "active";
  const search = q ?? "";

  const supabase = await createClient();
  const [{ data: categories }, firstPage] = await Promise.all([
    supabase.from("product_categories").select("id,name").order("name"),
    getProductsPage(status, search, null),
  ]);

  const emptyMessage = search.trim()
    ? `Sin resultados para "${search.trim()}".`
    : status === "active"
      ? "No hay productos activos con este filtro."
      : status === "inactive"
        ? "No hay productos inactivos."
        : "Todavía no cargaste ningún producto.";

  return (
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Estado</span>
          {STATUS_FILTERS.map((f) => (
            <Link key={f.value} href={statusFilterHref(f.value, search)}>
              <Badge variant={status === f.value ? "secondary" : "outline"} className="cursor-pointer">
                {f.label}
              </Badge>
            </Link>
          ))}
        </div>
        <ProductsSearch key={`${status}:${search}`} initialValue={search} status={status} />
      </div>

      <ProductsList
        key={`${status}:${search}`}
        initialProducts={firstPage.products}
        initialPrices={firstPage.prices}
        initialCursor={firstPage.nextCursor}
        status={status}
        search={search}
        emptyMessage={emptyMessage}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
