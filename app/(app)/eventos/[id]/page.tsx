import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { EventStatusSelect } from "./event-status-select";
import { RegistrationsPanel, type RegistrationRow } from "./registrations-panel";
import { EditEventForm, type EditableEvent } from "./edit-event-form";
import { EventImagePanel } from "./event-image-panel";
import { PublicLinkCard } from "./public-link-card";
import { archiveEvent, deleteEvent } from "./actions";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations") || hasRole(user, "workshop_staff");
  const canDelete = isOwner(user);

  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      "id,human_code,event_type,name,slug,description,event_date,start_time,end_time,schedule,capacity,price,cost_estimate,status,notes,location_id,address,image_path,additional_info,payment_account_id,is_registration_open,archived_at,locations(name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!event) notFound();

  const [
    { data: registrations },
    { data: customers },
    { data: fairOrders },
    { data: locations },
    { data: paymentAccounts },
  ] = await Promise.all([
    supabase
      .from("event_registrations")
      .select("id,quantity,unit_price,payment_status,status,participant_name,customers(first_name,last_name,whatsapp)")
      .eq("event_id", id)
      .order("created_at"),
    supabase.from("customers").select("id,first_name,last_name").eq("is_active", true).order("first_name"),
    event.event_type === "fair"
      ? supabase.from("orders").select("id,human_code,total").eq("event_id", id)
      : Promise.resolve({ data: [] as { id: string; human_code: string; total: number }[] }),
    supabase.from("locations").select("id,name").eq("is_active", true).order("name"),
    supabase.from("payment_accounts").select("id,name").eq("is_active", true).order("code"),
  ]);

  const registrationRows: RegistrationRow[] = (registrations ?? []).map((r) => {
    const customer = r.customers as unknown as {
      first_name: string;
      last_name: string | null;
      whatsapp: string | null;
    } | null;
    return {
      id: r.id,
      customerName: customer ? customerDisplayName(customer) : "—",
      participantName: r.participant_name,
      whatsapp: customer?.whatsapp ?? null,
      quantity: r.quantity,
      unit_price: r.unit_price,
      payment_status: r.payment_status,
      status: r.status,
    };
  });

  const registrationRevenue = registrationRows
    .filter((r) => (r.status === "confirmed" || r.status === "attended") && r.payment_status === "paid")
    .reduce((sum, r) => sum + (r.unit_price ?? 0) * r.quantity, 0);
  const fairRevenue = (fairOrders ?? []).reduce((sum, o) => sum + o.total, 0);
  const totalRevenue = registrationRevenue + fairRevenue;
  const result = totalRevenue - (event.cost_estimate ?? 0);

  const imagesBucket = supabase.storage.from("event-images");
  const imageUrl = event.image_path ? imagesBucket.getPublicUrl(event.image_path).data.publicUrl : null;

  const editableEvent: EditableEvent = {
    event_type: event.event_type,
    name: event.name,
    slug: event.slug,
    description: event.description,
    location_id: event.location_id,
    address: event.address,
    event_date: event.event_date,
    start_time: event.start_time,
    end_time: event.end_time,
    schedule: event.schedule,
    capacity: event.capacity,
    price: event.price,
    cost_estimate: event.cost_estimate,
    payment_account_id: event.payment_account_id,
    additional_info: event.additional_info,
    is_registration_open: event.is_registration_open,
    notes: event.notes,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/eventos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Eventos
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{event.name}</h1>
            <EventStatusSelect eventId={event.id} status={event.status} canEdit={canEdit} />
          </div>
          {canEdit && !event.archived_at && (
            <div className="flex gap-2">
              <ConfirmAction
                trigger={<Button size="sm" variant="outline" />}
                title="¿Archivar este evento?"
                description="Deja de aparecer en las listas activas y en el calendario, pero conserva todo su historial."
                confirmLabel="Archivar"
                variant="default"
                onConfirm={archiveEvent.bind(null, event.id)}
              >
                Archivar
              </ConfirmAction>
              {canDelete && (
                <ConfirmAction
                  trigger={<Button size="sm" variant="outline" className="text-destructive" />}
                  title="¿Eliminar este evento?"
                  description="Sólo se puede si no tiene inscripciones, ventas ni transferencias de stock asociadas. Esta acción no se puede deshacer."
                  confirmLabel="Eliminar"
                  onConfirm={deleteEvent.bind(null, event.id)}
                >
                  Eliminar
                </ConfirmAction>
              )}
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {event.human_code} · {formatDate(event.event_date)}
          {event.start_time && ` · ${event.start_time.slice(0, 5)}hs`}
          {event.locations && ` · ${(event.locations as unknown as { name: string }).name}`}
          {event.archived_at && " · Archivado"}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <EditEventForm
          eventId={event.id}
          event={editableEvent}
          locations={locations ?? []}
          paymentAccounts={paymentAccounts ?? []}
          canEdit={canEdit}
        />

        <div className="flex flex-col gap-6">
          {event.event_type === "workshop" && (
            <PublicLinkCard slug={event.slug} isPublic={event.status === "published" || event.status === "full"} />
          )}
          <EventImagePanel eventId={event.id} imageUrl={imageUrl} canEdit={canEdit} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultado</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {registrationRevenue > 0 && (
              <Row label="Ingresos por inscripciones" value={formatCurrency(registrationRevenue)} />
            )}
            {event.event_type === "fair" && (
              <Row label="Ingresos por ventas en la feria" value={formatCurrency(fairRevenue)} />
            )}
            <Row label="Ingresos totales" value={formatCurrency(totalRevenue)} strong />
            <Row label="Costo estimado" value={formatCurrency(event.cost_estimate ?? 0)} />
            <Row
              label="Resultado"
              value={formatCurrency(result)}
              strong
              className={result < 0 ? "text-destructive" : "text-emerald-600"}
            />
            {event.event_type === "fair" && (fairOrders ?? []).length > 0 && (
              <div className="mt-2 border-t pt-2">
                <p className="text-xs text-muted-foreground">Pedidos de esta feria:</p>
                {(fairOrders ?? []).map((o) => (
                  <Link
                    key={o.id}
                    href={`/pedidos/${o.id}`}
                    className="block text-xs underline underline-offset-2"
                  >
                    {o.human_code} — {formatCurrency(o.total)}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inscriptos</CardTitle>
          </CardHeader>
          <CardContent>
            <RegistrationsPanel
              eventId={event.id}
              registrations={registrationRows}
              customers={(customers ?? []).map((c) => ({ id: c.id, name: customerDisplayName(c) }))}
              defaultUnitPrice={event.price}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  className,
}: {
  label: string;
  value: string;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex justify-between ${strong ? "font-medium" : ""} ${className ?? ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
