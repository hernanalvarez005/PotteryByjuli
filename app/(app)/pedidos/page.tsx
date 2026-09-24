import Link from "next/link";
import { Plus, LayoutGrid, List } from "lucide-react";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getOrdersKanbanBoard, getOrdersPage, type OrdersPageCursor } from "@/lib/orders";
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
  searchParams: Promise<{ view?: string; archived?: string; cursorCreatedAt?: string; cursorId?: string }>;
}) {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");
  const params = await searchParams;
  const view = params.view === "kanban" ? "kanban" : "list";
  const showArchived = params.archived === "1";
  // El cursor sólo tiene sentido en Lista.
  const cursor: OrdersPageCursor =
    view === "list" && params.cursorCreatedAt && params.cursorId
      ? { createdAt: params.cursorCreatedAt, id: params.cursorId }
      : null;

  // Kanban y Lista usan queries completamente separadas (perf audit
  // H-08 bloque 3) — un Kanban es "todo el trabajo activo agrupado por
  // estado", nunca "página 1 de N", así que no comparten estrategia de
  // datos aunque compartan la misma pantalla.
  const kanbanData = view === "kanban" ? await getOrdersKanbanBoard({ includeArchived: showArchived }) : null;
  const listData = view === "list" ? await getOrdersPage({ operationType: "order", includeArchived: showArchived }, cursor) : null;

  const isEmpty =
    view === "kanban"
      ? Object.values(kanbanData!.counts).every((c) => c === 0)
      : listData!.orders.length === 0;
  const nextCursor = listData?.nextCursor ?? null;

  function viewHref(nextView: "list" | "kanban") {
    const qs = new URLSearchParams();
    if (nextView !== "list") qs.set("view", nextView);
    if (showArchived) qs.set("archived", "1");
    // Cambiar de vista siempre vuelve a la primera página.
    const query = qs.toString();
    return query ? `/pedidos?${query}` : "/pedidos";
  }

  function archivedHref(next: boolean) {
    const qs = new URLSearchParams();
    if (view !== "list") qs.set("view", view);
    if (next) qs.set("archived", "1");
    // Cambiar el filtro de archivados también vuelve a la primera página
    // — el cursor de la página anterior ya no representa un límite
    // válido para el nuevo conjunto de resultados.
    const query = qs.toString();
    return query ? `/pedidos?${query}` : "/pedidos";
  }

  function nextPageHref(): string | null {
    if (!nextCursor) return null;
    const qs = new URLSearchParams();
    if (showArchived) qs.set("archived", "1");
    qs.set("cursorCreatedAt", nextCursor.createdAt);
    qs.set("cursorId", nextCursor.id);
    return `/pedidos?${qs.toString()}`;
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

      {isEmpty ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay pedidos cargados.
        </p>
      ) : view === "kanban" ? (
        <PedidosKanban
          ordersByStatus={kanbanData!.ordersByStatus}
          counts={kanbanData!.counts}
          paidByOrder={kanbanData!.paidByOrder}
          canEdit={canEdit}
        />
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
            {listData!.orders.map((order) => {
              const paid = listData!.paidByOrder[order.id] ?? 0;
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

      {view === "list" && nextPageHref() && (
        <Link href={nextPageHref()!} className="self-center">
          <Button variant="outline" size="sm">
            Cargar más
          </Button>
        </Link>
      )}
    </div>
  );
}
