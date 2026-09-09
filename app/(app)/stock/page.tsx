import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getFinishedGoodsStock, summarizeStockByProduct } from "@/lib/inventory";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AdjustmentDialog } from "./adjustment-dialog";
import { AddProductDialog } from "./add-product-dialog";
import { TransferForm } from "./transfer-form";
import { TransferRow } from "./transfer-row";

function stockStatus(available: number, min: number | null) {
  if (available <= 0) return { label: "Sin stock", variant: "destructive" as const };
  if (min != null && available <= min) return { label: "Bajo", variant: "outline" as const };
  return { label: "Normal", variant: "secondary" as const };
}

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");
  const { location: selectedLocationId } = await searchParams;

  const supabase = await createClient();
  const stockRows = await getFinishedGoodsStock();
  const productSummaries = summarizeStockByProduct(stockRows);
  const filteredRows = selectedLocationId
    ? stockRows.filter((row) => row.locationId === selectedLocationId)
    : [];

  const [{ data: locations }, { data: transfers }, { data: inventoryItems }] = await Promise.all([
    supabase.from("locations").select("id,name").eq("is_active", true).order("name"),
    supabase
      .from("stock_transfers")
      .select(
        "id,human_code,status,created_at,from:from_location_id(name),to:to_location_id(name),stock_transfer_items(quantity,inventory_items(product_variants(name,products(name))))"
      )
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("inventory_items")
      .select("id,product_variants(name,is_active,products(name,is_active))")
      .eq("item_type", "finished_good")
      .eq("is_active", true),
  ]);

  const productOptions = (inventoryItems ?? [])
    .map((row) => {
      const variant = row.product_variants as unknown as {
        name: string;
        is_active: boolean;
        products: { name: string; is_active: boolean } | null;
      } | null;
      if (!variant?.is_active || !variant.products?.is_active) return null;
      const label =
        variant.name === "Único" ? variant.products.name : `${variant.products.name} — ${variant.name}`;
      return { id: row.id, name: label };
    })
    .filter((v): v is { id: string; name: string } => v !== null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stock</h1>
          <p className="text-muted-foreground">
            Físico, reservado y disponible por ubicación. Una transferencia
            entre ubicaciones nunca es una venta.
          </p>
        </div>
        {canEdit && <AddProductDialog products={productOptions} locations={locations ?? []} />}
      </div>

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="transferencias">Transferencias</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Ubicación:</span>
            <Link href="/stock">
              <Badge variant={!selectedLocationId ? "secondary" : "outline"} className="cursor-pointer">
                Todas
              </Badge>
            </Link>
            {(locations ?? []).map((loc) => (
              <Link key={loc.id} href={`/stock?location=${loc.id}`}>
                <Badge variant={selectedLocationId === loc.id ? "secondary" : "outline"} className="cursor-pointer">
                  {loc.name}
                </Badge>
              </Link>
            ))}
          </div>

          {stockRows.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Todavía no hay productos activos.
            </p>
          ) : !selectedLocationId ? (
            // "Todas" — agregado real por producto, nunca el mismo número
            // repetido en cada ubicación (docs/business-rules.md § Stock).
            <div className="flex flex-col gap-3">
              {productSummaries.map((summary) => {
                const status = stockStatus(summary.totalAvailable, null);
                return (
                  <div key={summary.inventoryItemId} className="rounded-lg border bg-card p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{summary.productLabel}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant={status.variant}>{status.label}</Badge>
                        <span className="text-sm text-muted-foreground">
                          Total disponible: <span className="font-medium text-foreground">{summary.totalAvailable}</span>
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-col gap-1 border-t pt-2">
                      {summary.byLocation.map((loc) => (
                        <div key={loc.locationId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="text-muted-foreground">{loc.locationName}</span>
                          <div className="flex items-center gap-3">
                            <span>
                              Físico {loc.physical} · Reservado {loc.reserved} · Disponible {loc.available}
                            </span>
                            {canEdit && (
                              <AdjustmentDialog
                                inventoryItemId={summary.inventoryItemId}
                                locationId={loc.locationId}
                                productLabel={summary.productLabel}
                                locationName={loc.locationName}
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Físico</TableHead>
                  <TableHead>Reservado</TableHead>
                  <TableHead>Disponible</TableHead>
                  <TableHead>Estado</TableHead>
                  {canEdit && <TableHead className="text-right">Acciones</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => {
                  const status = stockStatus(row.available, row.minQuantity);
                  return (
                    <TableRow key={`${row.inventoryItemId}:${row.locationId}`}>
                      <TableCell className="font-medium">{row.productLabel}</TableCell>
                      <TableCell>{row.physical}</TableCell>
                      <TableCell>{row.reserved}</TableCell>
                      <TableCell>{row.available}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <AdjustmentDialog
                            inventoryItemId={row.inventoryItemId}
                            locationId={row.locationId}
                            productLabel={row.productLabel}
                            locationName={row.locationName}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="transferencias" className="flex flex-col gap-4">
          <div className="flex justify-end">
            {canEdit && <TransferForm locations={locations ?? []} products={productOptions} />}
          </div>

          {(transfers ?? []).length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Todavía no hay transferencias.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Ruta</TableHead>
                  <TableHead>Productos</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha</TableHead>
                  {canEdit && <TableHead className="text-right">Acciones</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(transfers ?? []).map((t) => {
                  const from = t.from as unknown as { name: string } | null;
                  const to = t.to as unknown as { name: string } | null;
                  const items = (t.stock_transfer_items ?? []) as unknown as {
                    quantity: number;
                    inventory_items: {
                      product_variants: { name: string; products: { name: string } | null } | null;
                    } | null;
                  }[];
                  const summary = items
                    .map((it) => {
                      const variant = it.inventory_items?.product_variants;
                      const label = variant
                        ? variant.name === "Único"
                          ? variant.products?.name
                          : `${variant.products?.name} — ${variant.name}`
                        : "—";
                      return `${label} ×${it.quantity}`;
                    })
                    .join(", ");

                  return (
                    <TransferRow
                      key={t.id}
                      id={t.id}
                      humanCode={t.human_code}
                      fromLocation={from?.name ?? "—"}
                      toLocation={to?.name ?? "—"}
                      status={t.status}
                      createdAt={t.created_at}
                      itemsSummary={summary}
                      canEdit={canEdit}
                    />
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
