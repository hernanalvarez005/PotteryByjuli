import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getFinishedGoodsStock } from "@/lib/inventory";
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
import { TransferForm } from "./transfer-form";
import { TransferRow } from "./transfer-row";

function stockStatus(available: number, min: number | null) {
  if (available <= 0) return { label: "Sin stock", variant: "destructive" as const };
  if (min != null && available <= min) return { label: "Bajo", variant: "outline" as const };
  return { label: "Normal", variant: "secondary" as const };
}

export default async function StockPage() {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");

  const supabase = await createClient();
  const stockRows = await getFinishedGoodsStock();

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stock</h1>
        <p className="text-muted-foreground">
          Físico, reservado y disponible por ubicación. Una transferencia
          entre ubicaciones nunca es una venta.
        </p>
      </div>

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="transferencias">Transferencias</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="flex flex-col gap-4">
          {stockRows.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Todavía no hay productos activos.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Ubicación</TableHead>
                  <TableHead>Físico</TableHead>
                  <TableHead>Reservado</TableHead>
                  <TableHead>Disponible</TableHead>
                  <TableHead>Estado</TableHead>
                  {canEdit && <TableHead className="text-right">Acciones</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockRows.map((row) => {
                  const status = stockStatus(row.available, row.minQuantity);
                  return (
                    <TableRow key={`${row.inventoryItemId}:${row.locationId}`}>
                      <TableCell className="font-medium">{row.productLabel}</TableCell>
                      <TableCell className="text-muted-foreground">{row.locationName}</TableCell>
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
