import Link from "next/link";
import { Plus, LayoutGrid, List } from "lucide-react";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getOrders } from "@/lib/orders";
import { customerDisplayName } from "@/lib/customers";
import { formatCurrency, formatDate } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/schemas/orders";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PedidosKanban } from "./pedidos-kanban";

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; archived?: string }>;
}) {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");
  const params = await searchParams;
  const view = params.view === "kanban" ? "kanban" : "list";
  const showArchived = params.archived === "1";
  const { orders, paidByOrder } = await getOrders({ operationType: "order", includeArchived: showArchived });

  function viewHref(nextView: "list" | "kanban") {
    const qs = new URLSearchParams();
    if (nextView !== "list") qs.set("view", nextView);
    if (showArchived) qs.set("archived", "1");
    const query = qs.toString();
    return query ? `/pedidos?${query}` : "/pedidos";
  }

  function archivedHref(next: boolean) {
    const qs = new URLSearchParams();
    if (view !== "list") qs.set("view", view);
    if (next) qs.set("archived", "1");
    const query = qs.toString();
    return query ? `/pedidos?${query}` : "/pedidos";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
          <p className="text-muted-foreground">
            Encargos y personalizados — mayoristas se suman en la Fase 5. Las
            ventas minoristas viven en Ventas.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Link href="/pedidos/nuevo">
              <Button size="sm">
                <Plus className="size-4" />
                Nuevo pedido
              </Button>
            </Link>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-md border p-1">
          <Link href={viewHref("list")}>
            <Button size="sm" variant={view === "list" ? "secondary" : "ghost"} className="gap-1.5">
              <List className="size-4" />
              Lista
            </Button>
          </Link>
          <Link href={viewHref("kanban")}>
            <Button size="sm" variant={view === "kanban" ? "secondary" : "ghost"} className="gap-1.5">
              <LayoutGrid className="size-4" />
              Kanban
            </Button>
          </Link>
        </div>
        {view === "kanban" && (
          <Link href={archivedHref(!showArchived)} className="text-xs text-muted-foreground hover:text-foreground">
            {showArchived ? "Ocultar archivados" : "Ver archivados"}
          </Link>
        )}
      </div>

      {orders.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay pedidos cargados.
        </p>
      ) : view === "kanban" ? (
        <PedidosKanban orders={orders} paidByOrder={paidByOrder} canEdit={canEdit} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Unidad</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Saldo</TableHead>
              <TableHead>Fecha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => {
              const paid = paidByOrder[order.id] ?? 0;
              const balance = order.total - paid;
              return (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link
                      href={`/pedidos/${order.id}`}
                      className="font-medium hover:underline"
                    >
                      {order.human_code}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {order.customers ? customerDisplayName(order.customers) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {order.business_units?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{ORDER_STATUS_LABELS[order.status]}</Badge>
                  </TableCell>
                  <TableCell>{formatCurrency(order.total)}</TableCell>
                  <TableCell className={balance > 0 ? "text-amber-600" : "text-muted-foreground"}>
                    {formatCurrency(balance)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(order.created_at)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
