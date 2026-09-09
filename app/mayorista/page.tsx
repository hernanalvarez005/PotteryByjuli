import { getWholesaleCatalog } from "@/lib/wholesale";
import { formatCurrency } from "@/lib/format";
import { CatalogGrid } from "./catalog-grid";
import { CartSheet } from "./cart-sheet";

export default async function MayoristaPage() {
  const { categories, products, settings } = await getWholesaleCatalog();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Catálogo mayorista</h1>
        {settings?.commercial_message && (
          <p className="text-sm text-muted-foreground">{settings.commercial_message}</p>
        )}
        {settings && (settings.min_order_amount || settings.min_total_units) && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Condiciones</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
              {settings.min_order_amount && (
                <li>Pedido mínimo: {formatCurrency(settings.min_order_amount)}</li>
              )}
              {settings.min_total_units && <li>Mínimo: {settings.min_total_units} piezas</li>}
              {settings.lead_time_min_days && settings.lead_time_max_days && (
                <li>
                  Plazo estimado: {settings.lead_time_min_days}–{settings.lead_time_max_days} días
                </li>
              )}
              {settings.payment_terms && <li>Pago: {settings.payment_terms}</li>}
              {settings.shipping_terms && <li>Envío: {settings.shipping_terms}</li>}
            </ul>
          </div>
        )}
      </div>

      {products.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Todavía no hay productos publicados en el catálogo mayorista.
        </p>
      ) : (
        <CatalogGrid products={products} categories={categories} />
      )}

      <CartSheet products={products} settings={settings} />
    </div>
  );
}
