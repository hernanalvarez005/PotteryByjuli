"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { customerDisplayName } from "@/lib/customers-shared";
import { formatCurrency, formatDate } from "@/lib/format";
import { StatusSelect } from "./[id]/status-select";
import { archiveOrder, unarchiveOrder } from "./actions";
import type { OrderListRow, KanbanStatus } from "@/lib/orders";

// Kanban de Pedidos (Bloque 4) — toggle sobre el listado de siempre,
// nunca lo reemplaza. Sólo 4 columnas de las 6 de order_status:
// 'pending' todavía no es trabajo confirmado (vive en la Lista, no acá)
// y 'cancelled' es una salida terminal, no una etapa de producción.
// Avanzar una tarjeta reusa StatusSelect (mismo set_order_status de
// siempre) — nunca una segunda máquina de estados.
const KANBAN_COLUMNS: { status: KanbanStatus; label: string }[] = [
  { status: "confirmed", label: "Confirmado" },
  { status: "in_production", label: "En producción" },
  { status: "ready", label: "Listo para entregar" },
  { status: "delivered", label: "Entregado" },
];

export function PedidosKanban({
  ordersByStatus,
  counts,
  paidByOrder,
  canEdit,
  missingPdfOrderIds,
}: {
  ordersByStatus: Record<KanbanStatus, OrderListRow[]>;
  /** Conteo real por columna (perf audit H-08 bloque 3) — nunca
   * `columnOrders.length`, que sólo refleja hasta KANBAN_DETAIL_LIMIT
   * tarjetas. Antes de este fix, con 23.400 pedidos 'confirmed' reales,
   * el badge mostraba "1000" (el límite de página de PostgREST sobre
   * una query sin acotar), no el número real. */
  counts: Record<KanbanStatus, number>;
  paidByOrder: Record<string, number>;
  canEdit: boolean;
  /** Solicitudes del checkout mayorista sin PDF (ver lib/wholesale-document-state.ts). */
  missingPdfOrderIds: string[];
}) {
  const missingPdf = new Set(missingPdfOrderIds);
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {KANBAN_COLUMNS.map((col) => {
        const columnOrders = ordersByStatus[col.status];
        const count = counts[col.status];
        const isTruncated = count > columnOrders.length;
        return (
          <div key={col.status} className="flex w-72 shrink-0 flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold">{col.label}</h3>
              <Badge variant="outline">{count}</Badge>
            </div>
            {isTruncated && (
              <p className="px-1 text-xs text-muted-foreground">
                Mostrando las {columnOrders.length} más recientes de {count}.
              </p>
            )}
            <div className="flex flex-col gap-3">
              {columnOrders.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Sin pedidos
                </p>
              ) : (
                columnOrders.map((order) => (
                  <KanbanCard
                    key={order.id}
                    order={order}
                    paid={paidByOrder[order.id] ?? 0}
                    canEdit={canEdit}
                    missingPdf={missingPdf.has(order.id)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  order,
  paid,
  canEdit,
  missingPdf,
}: {
  order: OrderListRow;
  paid: number;
  canEdit: boolean;
  missingPdf: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const balance = order.total - paid;

  return (
    <Card className={order.archived_at ? "opacity-60" : undefined}>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/pedidos/${order.id}`} className="text-sm font-medium hover:underline">
            {order.human_code}
          </Link>
          <div className="flex items-center gap-1">
            {missingPdf && (
              <Badge
                variant="outline"
                className="border-amber-300 text-[10px] text-amber-700"
                title="La solicitud mayorista no tiene su PDF. Abrí el pedido para generarlo."
              >
                Sin PDF
              </Badge>
            )}
            {order.archived_at && (
              <Badge variant="outline" className="text-[10px]">
                Archivado
              </Badge>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {order.customers ? customerDisplayName(order.customers) : "Sin cliente"}
        </p>
        <div className="flex items-center justify-between text-xs">
          <span>{formatCurrency(order.total)}</span>
          {balance > 0 && <span className="text-amber-600">Debe {formatCurrency(balance)}</span>}
        </div>
        {order.estimated_date && (
          <p className="text-xs text-muted-foreground">Entrega: {formatDate(order.estimated_date)}</p>
        )}
        {canEdit && (
          <div className="mt-1 flex flex-col gap-2">
            <StatusSelect orderId={order.id} status={order.status} canEdit={canEdit} />
            {order.status === "delivered" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 self-start px-2 text-xs text-muted-foreground"
                disabled={isPending}
                onClick={() =>
                  startTransition(() =>
                    order.archived_at ? unarchiveOrder(order.id) : archiveOrder(order.id)
                  )
                }
              >
                {order.archived_at ? "Desarchivar" : "Archivar"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
