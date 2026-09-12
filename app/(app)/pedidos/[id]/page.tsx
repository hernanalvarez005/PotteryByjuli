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
import { DocumentPanel } from "./document-panel";
import { generateWholesaleDocumentForOrder, generateOrderSummaryPdf } from "./document-actions";
import { AssociateCustomerDialog } from "./associate-customer-dialog";

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
      "id,human_code,status,subtotal,discount_total,total,notes,delivery_method,delivery_address,estimated_date,created_at,wholesale_terms_snapshot,customers(id,first_name,last_name,whatsapp,email,company_name,cuit,instagram,website,city,province,address,postal_code),business_units(code,name),locations(name),origin:origin_channel_id(name),closing:closing_channel_id(name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  const businessUnit = order.business_units as unknown as { code: string; name: string } | null;
  const isWholesaleOrder = businessUnit?.code === "wholesale";

  const [{ data: items }, { data: payments }, { data: history }, { data: methods }, { data: accounts }, { data: customers }] =
    await Promise.all([
      supabase
        .from("order_items")
        .select("id,quantity,unit_price,custom_name,custom_description,product_variants(name,products(name))")
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
      supabase.from("customers").select("id,first_name,last_name").eq("is_active", true).order("first_name"),
    ]);

  const paid = (payments ?? []).reduce((sum, p) => sum + p.amount, 0);
  const balance = order.total - paid;

  const customer = order.customers as unknown as {
    id: string;
    first_name: string;
    last_name: string | null;
    whatsapp: string | null;
    email: string | null;
    company_name: string | null;
    cuit: string | null;
    instagram: string | null;
    website: string | null;
    city: string | null;
    province: string | null;
    address: string | null;
    postal_code: string | null;
  } | null;

  // Sólo relevante para pedidos mayoristas: documento generado en el
  // checkout, y un posible conflicto de identidad sin resolver del cliente
  // asociado (ver docs/business-rules.md § Checkout mayorista — dedup).
  const [{ data: attachment }, { data: summaryAttachment }, { data: identityConflict }] = await Promise.all([
    isWholesaleOrder
      ? supabase
          .from("order_attachments")
          .select("storage_path")
          .eq("order_id", id)
          .eq("kind", "wholesale_request_pdf")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // "Resumen PDF del pedido" (sección 10/11) — cualquier pedido que no
    // sea una solicitud mayorista (esa ya tiene su propio documento).
    !isWholesaleOrder
      ? supabase
          .from("order_attachments")
          .select("storage_path")
          .eq("order_id", id)
          .eq("kind", "order_summary_pdf")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    customer
      ? supabase
          .from("customer_identity_conflicts")
          .select("matched_customer_ids,signals,created_at")
          .eq("new_customer_id", customer.id)
          .is("resolved_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

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
        {customer ? (
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
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <p className="text-sm text-muted-foreground">Sin cliente asociado</p>
            {canEdit && (
              <AssociateCustomerDialog
                orderId={order.id}
                customers={(customers ?? []).map((c) => ({ id: c.id, name: customerDisplayName(c) }))}
              />
            )}
          </div>
        )}
        {identityConflict && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ⚠ Posible identidad duplicada — Revisión pendiente. Este cliente se creó porque WhatsApp,
            email y/o CUIT de la solicitud apuntaban a clientes distintos ya existentes — ninguno se
            modificó automáticamente. Revisar y reconciliar manualmente si corresponde.
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
                  // Un ítem sin variante es no inventariado/personalizado
                  // (custom_name) — nunca un producto real sin nombre.
                  const label = variant
                    ? variant.name === "Único"
                      ? variant.products?.name
                      : `${variant.products?.name} — ${variant.name}`
                    : item.custom_name;
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        {label}
                        {!variant && item.custom_description && (
                          <p className="text-xs text-muted-foreground">{item.custom_description}</p>
                        )}
                      </TableCell>
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

        {isWholesaleOrder && customer && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Comercio</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <Row label="Razón social" value={customer.company_name} />
              <Row label="CUIT" value={customer.cuit} />
              <Row label="Email" value={customer.email} />
              <Row label="Ciudad" value={customer.city} />
              <Row label="Provincia" value={customer.province} />
              <Row label="Dirección" value={customer.address} />
              <Row label="Código postal" value={customer.postal_code} />
              <Row label="Instagram" value={customer.instagram} />
              <Row label="Web" value={customer.website} />
            </CardContent>
          </Card>
        )}

        {isWholesaleOrder && order.wholesale_terms_snapshot && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Condiciones de la solicitud</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {(() => {
                const terms = order.wholesale_terms_snapshot as {
                  min_order_amount: number | null;
                  min_total_units: number | null;
                  lead_time_min_days: number | null;
                  lead_time_max_days: number | null;
                  payment_terms: string | null;
                  shipping_terms: string | null;
                };
                const leadTime =
                  terms.lead_time_min_days != null && terms.lead_time_max_days != null
                    ? `${terms.lead_time_min_days}–${terms.lead_time_max_days} días`
                    : undefined;
                return (
                  <>
                    <Row
                      label="Pedido mínimo"
                      value={terms.min_order_amount != null ? formatCurrency(terms.min_order_amount) : undefined}
                    />
                    <Row
                      label="Mínimo de piezas"
                      value={terms.min_total_units != null ? String(terms.min_total_units) : undefined}
                    />
                    <Row label="Plazo estimado" value={leadTime} />
                    <Row label="Forma de pago" value={terms.payment_terms} />
                    <Row label="Envío" value={terms.shipping_terms} />
                  </>
                );
              })()}
              <p className="pt-1 text-xs text-muted-foreground">
                Condiciones vigentes al momento de la solicitud — no cambian si Juli actualiza la
                configuración mayorista después.
              </p>
            </CardContent>
          </Card>
        )}

        {isWholesaleOrder && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documento</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentPanel
                orderId={order.id}
                storagePath={attachment?.storage_path ?? null}
                canEdit={canEdit}
                generateAction={generateWholesaleDocumentForOrder}
              />
            </CardContent>
          </Card>
        )}

        {!isWholesaleOrder && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resumen PDF</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentPanel
                orderId={order.id}
                storagePath={summaryAttachment?.storage_path ?? null}
                canEdit={canEdit}
                generateAction={generateOrderSummaryPdf}
                missingLabel="Todavía no se generó el resumen PDF de este pedido."
                generateLabel="Generar resumen PDF"
                allowRegenerate
              />
            </CardContent>
          </Card>
        )}

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
