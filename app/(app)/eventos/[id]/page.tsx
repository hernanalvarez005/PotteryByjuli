import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EventStatusSelect } from "./event-status-select";
import { RegistrationsPanel, type RegistrationRow } from "./registrations-panel";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations") || hasRole(user, "workshop_staff");

  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("id,human_code,event_type,name,event_date,schedule,capacity,price,cost_estimate,status,notes,locations(name)")
    .eq("id", id)
    .maybeSingle();

  if (!event) notFound();

  const [{ data: registrations }, { data: customers }, { data: fairOrders }] = await Promise.all([
    supabase
      .from("event_registrations")
      .select("id,quantity,unit_price,is_paid,status,customers(first_name,last_name)")
      .eq("event_id", id)
      .order("created_at"),
    supabase.from("customers").select("id,first_name,last_name").eq("is_active", true).order("first_name"),
    event.event_type === "fair"
      ? supabase.from("orders").select("id,human_code,total").eq("event_id", id)
      : Promise.resolve({ data: [] as { id: string; human_code: string; total: number }[] }),
  ]);

  const registrationRows: RegistrationRow[] = (registrations ?? []).map((r) => ({
    id: r.id,
    customerName: r.customers ? customerDisplayName(r.customers as unknown as { first_name: string; last_name: string | null }) : "—",
    quantity: r.quantity,
    unit_price: r.unit_price,
    is_paid: r.is_paid,
    status: r.status,
  }));

  const registrationRevenue = registrationRows
    .filter((r) => r.status === "registered" && r.is_paid)
    .reduce((sum, r) => sum + (r.unit_price ?? 0) * r.quantity, 0);
  const fairRevenue = (fairOrders ?? []).reduce((sum, o) => sum + o.total, 0);
  const totalRevenue = registrationRevenue + fairRevenue;
  const result = totalRevenue - (event.cost_estimate ?? 0);

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
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{event.name}</h1>
          <EventStatusSelect eventId={event.id} status={event.status} canEdit={canEdit} />
        </div>
        <p className="text-sm text-muted-foreground">
          {event.human_code} · {formatDate(event.event_date)}
          {event.schedule && ` · ${event.schedule}`}
          {event.locations && ` · ${(event.locations as unknown as { name: string }).name}`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
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
