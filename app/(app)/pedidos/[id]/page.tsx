import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { customerDisplayName, whatsappLink } from "@/lib/customers";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/schemas/orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusSelect } from "./status-select";
import { PaymentsPanel, type Payment } from "./payments-panel";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id,human_code,status,subtotal,discount_total,total,notes,delivery_method,delivery_address,estimated_date,created_at,customers(id,first_name,last_name,whatsapp),business_units(name),locations(name),origin:origin_channel_id(name),closing:closing_channel_id(name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  const [{ data: items }, { data: payments }, { data: history }, { data: methods }, { data: accounts }] =
    await Promise.all([
      supabase
        .from("order_items")
        .select("id,quantity,unit_price,product_variants(name,products(name))")
        .eq("order_id", id),
      supabase
        .from("payments")
        .select("id,amount,paid_at,reference,payment_methods(name)")
        .eq("order_id", id)
        .order("paid_at", { ascending: false }),
      supabase
        .from("order_status_history")
        .select("id,status,changed_at,profiles(full_name)")
        .eq("order_id", id)
        .order("changed_at", { ascending: false }),
      supabase.from("payment_methods").select("id,name").eq("is_active", true).order("sort_order"),
      supabase.from("payment_accounts").select("id,name").eq("is_active", true).order("code"),
    ]);

  const paid = (payments ?? []).reduce((sum, p) => sum + p.amount, 0);
  const balance = order.total - paid;

  const customer = order.customers as unknown as {
    id: string;
    first_name: string;
    last_name: string | null;
    whatsapp: string | null;
  } | null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/pedidos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Pedidos
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{order.human_code}</h1>
          <StatusSelect orderId={order.id} status={order.status} canEdit={canEdit} />
        </div>
        {customer && (
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/clientes/${customer.id}`} className="hover:underline">
              {customerDisplayName(customer)}
            </Link>
            {customer.whatsapp && (
              <a
                href={whatsappLink(customer.whatsapp)}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 inline-flex items-center gap-1 hover:text-foreground"
              >
                <MessageCircle className="size-3.5" />
                WhatsApp
              </a>
            )}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Productos</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Cant.</TableHead>
                  <TableHead>Precio</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(items ?? []).map((item) => {
                  const variant = item.product_variants as unknown as {
                    name: string;
                    products: { name: string } | null;
                  } | null;
                  const label = variant
                    ? variant.name === "Único"
                      ? variant.products?.name
                      : `${variant.products?.name} — ${variant.name}`
                    : "—";
                  return (
                    <TableRow key={item.id}>
                      <TableCell>{label}</TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>{formatCurrency(item.unit_price)}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(item.quantity * item.unit_price)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="mt-4 flex flex-col gap-1 border-t pt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(order.subtotal)}</span>
              </div>
              {order.discount_total > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Descuento</span>
                  <span>− {formatCurrency(order.discount_total)}</span>
                </div>
              )}
              <div className="flex justify-between font-medium">
                <span>Total</span>
                <span>{formatCurrency(order.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cobrado</span>
                <span>{formatCurrency(paid)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Saldo</span>
                <span className={balance > 0 ? "text-amber-600" : ""}>
                  {formatCurrency(balance)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <PaymentsPanel
          orderId={order.id}
          payments={(payments ?? []) as unknown as Payment[]}
          methods={methods ?? []}
          accounts={accounts ?? []}
          canEdit={canEdit}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detalles</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Row
              label="Unidad de negocio"
              value={(order.business_units as unknown as { name: string } | null)?.name}
            />
            <Row
              label="Origen comercial"
              value={(order.origin as unknown as { name: string } | null)?.name}
            />
            <Row
              label="Canal de cierre"
              value={(order.closing as unknown as { name: string } | null)?.name}
            />
            <Row
              label="Ubicación"
              value={(order.locations as unknown as { name: string } | null)?.name}
            />
            <Row
              label="Entrega"
              value={
                order.delivery_method === "pickup"
                  ? "Retiro"
                  : order.delivery_method === "shipping"
                    ? `Envío${order.delivery_address ? ` — ${order.delivery_address}` : ""}`
                    : order.delivery_method === "other"
                      ? "Otro"
                      : undefined
              }
            />
            <Row
              label="Fecha estimada"
              value={order.estimated_date ? formatDate(order.estimated_date) : undefined}
            />
            {order.notes && <Row label="Observaciones" value={order.notes} />}
            <Row label="Creado" value={formatDateTime(order.created_at)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historial de estados</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {(history ?? []).map((h) => (
                <li key={h.id} className="flex items-center justify-between">
                  <span>{ORDER_STATUS_LABELS[h.status]}</span>
                  <span className="text-xs text-muted-foreground">
                    {(h.profiles as unknown as { full_name: string | null } | null)?.full_name ?? "—"}{" "}
                    · {formatDateTime(h.changed_at)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
