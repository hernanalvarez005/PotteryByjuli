import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getProductionOrders } from "@/lib/production";
import { PRODUCTION_STAGE_ORDER, PRODUCTION_STATUS_LABELS } from "@/schemas/production";
import { NewOrderDialog } from "./new-order-dialog";
import { ProductionCard } from "./production-card";

export default async function ProduccionPage() {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");

  const supabase = await createClient();
  const [orders, { data: variantsRaw }, { data: locations }] = await Promise.all([
    getProductionOrders(),
    supabase
      .from("product_variants")
      .select("id,name,is_active,products(name,is_active)")
      .eq("is_active", true),
    supabase.from("locations").select("id,name").eq("is_active", true).order("name"),
  ]);

  const variantOptions = (variantsRaw ?? [])
    .map((v) => {
      const product = v.products as unknown as { name: string; is_active: boolean } | null;
      if (!product?.is_active) return null;
      return { id: v.id, name: v.name === "Único" ? product.name : `${product.name} — ${v.name}` };
    })
    .filter((v): v is { id: string; name: string } => v !== null);

  const columns = [...PRODUCTION_STAGE_ORDER, "done"] as const;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Producción</h1>
          <p className="text-muted-foreground">
            Lo que hay que hacer, en qué etapa está, y qué generó cada
            pedido confirmado sin stock suficiente.
          </p>
        </div>
        {canEdit && <NewOrderDialog variants={variantOptions} locations={locations ?? []} />}
      </div>

      {orders.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay órdenes de producción activas.
        </p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((status) => {
            const cards = orders.filter((o) => o.status === status);
            return (
              <div key={status} className="flex w-64 shrink-0 flex-col gap-3">
                <p className="text-sm font-medium text-muted-foreground">
                  {PRODUCTION_STATUS_LABELS[status]}{" "}
                  <span className="text-xs">({cards.length})</span>
                </p>
                <div className="flex flex-col gap-2">
                  {cards.map((order) => (
                    <ProductionCard key={order.id} order={order} canEdit={canEdit} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
