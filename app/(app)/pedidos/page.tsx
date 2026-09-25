import Link from "next/link";
import { Plus, LayoutGrid, List } from "lucide-react";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getOrdersKanbanBoard, getOrdersPage, getOrdersReceivable, type OrdersPageCursor } from "@/lib/orders";
import { receivableNotes, resolveBusinessUnitFilter, type BusinessUnitFilterOption } from "@/lib/orders-receivable";
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
import { createClient } from "@/lib/supabase/server";
import { getMissingWholesalePdfOrderIds } from "@/lib/wholesale-document-state";

function MissingPdfBadge() {
  return (
    <Badge
      variant="outline"
      className="ml-2 border-amber-300 text-[10px] text-amber-700"
      title="La solicitud mayorista no tiene su PDF. Abrí el pedido para generarlo."
    >
      Sin PDF
    </Badge>
  );
}

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; archived?: string; unit?: string; cursorCreatedAt?: string; cursorId?: string }>;
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

  // Filtro por unidad de negocio (?unit=<code>): se resuelve UNA vez acá y el
  // mismo `businessUnitId` alimenta Lista, Kanban y el KPI — nunca cada uno por
  // su lado. Un código desconocido equivale a "todas".
  const supabaseForFilters = await createClient();
  const { data: unitRows } = await supabaseForFilters
    .from("business_units")
    .select("id,code,name")
    .eq("is_active", true)
    .order("sort_order");
  const units = (unitRows ?? []) as BusinessUnitFilterOption[];
  const unitFilter = resolveBusinessUnitFilter(params.unit, units);
  const businessUnitId = unitFilter?.id ?? null;

  // "Pendiente de cobrar": una sola consulta agregada en el servidor
  // (get_orders_receivable), independiente de la vista y de la paginación.
  const receivable = await getOrdersReceivable(businessUnitId);

  // Kanban y Lista usan queries completamente separadas (perf audit
  // H-08 bloque 3) — un Kanban es "todo el trabajo activo agrupado por
  // estado", nunca "página 1 de N", así que no comparten estrategia de
  // datos aunque compartan la misma pantalla.
  const kanbanData = view === "kanban" ? await getOrdersKanbanBoard({ includeArchived: showArchived, businessUnitId }) : null;
  const listData = view === "list" ? await getOrdersPage({ operationType: "order", includeArchived: showArchived, businessUnitId }, cursor) : null;

  // Señal operativa "Sin PDF": sólo para solicitudes del checkout mayorista
  // (wholesale_buyer_snapshot no nulo) que no tienen su PDF. Una query
  // acotada a los pedidos que se están mostrando.
  const shownOrderIds =
    view === "kanban"
      ? Object.values(kanbanData!.ordersByStatus).flat().map((o) => o.id)
      : (listData?.orders ?? []).map((o) => o.id);
  const missingPdfOrderIds = await getMissingWholesalePdfOrderIds(await createClient(), shownOrderIds);

  const isEmpty =
    view === "kanban"
      ? Object.values(kanbanData!.counts).every((c) => c === 0)
      : listData!.orders.length === 0;
  const nextCursor = listData?.nextCursor ?? null;

  function viewHref(nextView: "list" | "kanban") {
    const qs = new URLSearchParams();
    if (nextView !== "list") qs.set("view", nextView);
    if (showArchived) qs.set("archived", "1");
    if (unitFilter) qs.set("unit", unitFilter.code);
    // Cambiar de vista siempre vuelve a la primera página.
    const query = qs.toString();
    return query ? `/pedidos?${query}` : "/pedidos";
  }

  function unitHref(code: string | null) {
    const qs = new URLSearchParams();
    if (view !== "list") qs.set("view", view);
    if (showArchived) qs.set("archived", "1");
    if (code) qs.set("unit", code);
    // Cambiar de unidad vuelve a la primera página (el cursor ya no aplica).
    const query = qs.toString();
    return query ? `/pedidos?${query}` : "/pedidos";
  }

  function archivedHref(next: boolean) {
    const qs = new URLSearchParams();
    if (view !== "list") qs.set("view", view);
    if (next) qs.set("archived", "1");
    if (unitFilter) qs.set("unit", unitFilter.code);
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
    if (unitFilter) qs.set("unit", unitFilter.code);
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

      {receivable && (
        <div className="flex flex-col gap-1 rounded-md border bg-card p-4" data-testid="orders-receivable">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Pendiente de cobrar{unitFilter ? ` · ${unitFilter.name}` : ""}
          </p>
          <p className={`text-2xl font-semibold tracking-tight ${receivable.pendingTotal > 0 ? "text-amber-600" : ""}`}>
            {formatCurrency(receivable.pendingTotal)}
          </p>
          <p className="text-xs text-muted-foreground">
            {receivable.ordersCount === 0
              ? "No hay pedidos con saldo pendiente."
              : `${receivable.ordersCount} ${receivable.ordersCount === 1 ? "pedido con saldo" : "pedidos con saldo"} · sin contar cancelados`}
          </p>
          {receivableNotes({ data: receivable, view, showArchived, formatMoney: formatCurrency }).map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2" aria-label="Filtrar por unidad de negocio">
        <span className="text-sm text-muted-foreground">Unidad</span>
        <Link href={unitHref(null)}>
          <Badge variant={unitFilter ? "outline" : "secondary"} className="cursor-pointer">
            Todas
          </Badge>
        </Link>
        {units.map((u) => (
          <Link key={u.id} href={unitHref(u.code)}>
            <Badge variant={unitFilter?.id === u.id ? "secondary" : "outline"} className="cursor-pointer">
              {u.name}
            </Badge>
          </Link>
        ))}
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
          {unitFilter ? `No hay pedidos en ${unitFilter.name}.` : "Todavía no hay pedidos cargados."}
        </p>
      ) : view === "kanban" ? (
        <PedidosKanban
          ordersByStatus={kanbanData!.ordersByStatus}
          counts={kanbanData!.counts}
          paidByOrder={kanbanData!.paidByOrder}
          canEdit={canEdit}
          missingPdfOrderIds={[...missingPdfOrderIds]}
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
                    {missingPdfOrderIds.has(order.id) && <MissingPdfBadge />}
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
