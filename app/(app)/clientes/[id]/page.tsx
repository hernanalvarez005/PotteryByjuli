import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { customerDisplayName, whatsappLink } from "@/lib/customers";
import { formatCurrency, formatDate } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/schemas/orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CustomerInfoForm } from "./customer-info-form";
import { TagsPanel } from "./tags-panel";
import { NotesPanel, type Note } from "./notes-panel";
import { CustomerDangerActions } from "./customer-danger-actions";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");

  const supabase = await createClient();

  const [{ data: customer }, { data: allTags }, { data: tagLinks }, { data: notes }, { data: orders }, { data: enrollments }, { data: registrations }] =
    await Promise.all([
      supabase.from("customers").select("*").eq("id", id).maybeSingle(),
      supabase.from("customer_tags").select("id,name").order("sort_order"),
      supabase.from("customer_tag_links").select("tag_id").eq("customer_id", id),
      supabase
        .from("customer_notes")
        .select("id,note,created_at,profiles(full_name)")
        .eq("customer_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select("id,human_code,status,total,created_at")
        .eq("customer_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("workshop_enrollments")
        .select("id,status,workshop_groups(name,workshop_programs(name))")
        .eq("customer_id", id),
      supabase
        .from("event_registrations")
        .select("id,quantity,events(id,name,event_date)")
        .eq("customer_id", id)
        .in("status", ["confirmed", "attended"]),
    ]);

  if (!customer) notFound();

  const validOrders = (orders ?? []).filter((o) => o.status !== "cancelled");
  const totalSpent = validOrders.reduce((sum, o) => sum + o.total, 0);
  const averageTicket = validOrders.length > 0 ? totalSpent / validOrders.length : 0;
  const lastPurchase = validOrders[0]?.created_at ?? null;

  const formattedNotes: Note[] = (notes ?? []).map((n) => ({
    id: n.id,
    note: n.note,
    created_at: n.created_at,
    author_name:
      (n.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/clientes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Clientes
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {customerDisplayName(customer)}
            </h1>
            {!customer.is_active && <Badge variant="outline">Archivado</Badge>}
            {customer.whatsapp && (
              <a
                href={whatsappLink(customer.whatsapp)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <MessageCircle className="size-4" />
                WhatsApp
              </a>
            )}
          </div>
          <CustomerDangerActions
            customerId={customer.id}
            isActive={customer.is_active}
            canArchive={canEdit}
            canDelete={isOwner(user)}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CustomerInfoForm customerId={customer.id} customer={customer} canEdit={canEdit} />
        <TagsPanel
          customerId={customer.id}
          allTags={allTags ?? []}
          activeTagIds={(tagLinks ?? []).map((t) => t.tag_id)}
          canEdit={canEdit}
        />
        <NotesPanel customerId={customer.id} notes={formattedNotes} canEdit={canEdit} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pedidos</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Metric label="Total comprado" value={formatCurrency(totalSpent)} />
              <Metric label="Pedidos" value={String(validOrders.length)} />
              <Metric label="Ticket promedio" value={formatCurrency(averageTicket)} />
            </div>
            {lastPurchase && (
              <p className="text-xs text-muted-foreground">
                Última compra: {formatDate(lastPurchase)}
              </p>
            )}
            {(orders ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hizo ningún pedido.</p>
            ) : (
              <ul className="flex flex-col gap-1 border-t pt-3 text-sm">
                {(orders ?? []).slice(0, 8).map((o) => (
                  <li key={o.id} className="flex items-center justify-between">
                    <Link href={`/pedidos/${o.id}`} className="hover:underline">
                      {o.human_code}
                    </Link>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {formatCurrency(o.total)}
                      <Badge variant="outline">{ORDER_STATUS_LABELS[o.status]}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {((enrollments ?? []).length > 0 || (registrations ?? []).length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Talleres y eventos</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {(enrollments ?? []).map((e) => {
                const group = e.workshop_groups as unknown as {
                  name: string;
                  workshop_programs: { name: string } | null;
                } | null;
                return (
                  <div key={e.id} className="flex items-center justify-between text-sm">
                    <span>
                      {group?.workshop_programs?.name} — {group?.name}
                    </span>
                    <Badge variant="outline">{e.status === "active" ? "Activo" : e.status}</Badge>
                  </div>
                );
              })}
              {(registrations ?? []).map((r) => {
                const event = r.events as unknown as { id: string; name: string; event_date: string } | null;
                if (!event) return null;
                return (
                  <Link
                    key={r.id}
                    href={`/eventos/${event.id}`}
                    className="flex items-center justify-between text-sm hover:underline"
                  >
                    <span>{event.name}</span>
                    <span className="text-muted-foreground">{formatDate(event.event_date)}</span>
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
