import Link from "next/link";
import { Plus } from "lucide-react";
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

export default async function PedidosPage() {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");
  const { orders, paidByOrder } = await getOrders();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
          <p className="text-muted-foreground">
            Minoristas y personalizados — mayoristas se suman en la Fase 5.
          </p>
        </div>
        {canEdit && (
          <Link href="/pedidos/nuevo">
            <Button size="sm">
              <Plus className="size-4" />
              Nuevo pedido
            </Button>
          </Link>
        )}
      </div>

      {orders.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay pedidos cargados.
        </p>
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
