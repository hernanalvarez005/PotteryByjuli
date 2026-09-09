import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getEvents } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { EVENT_STATUS_LABELS } from "@/schemas/events";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewEventDialog } from "./new-event-dialog";

export default async function EventosPage() {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations") || hasRole(user, "workshop_staff");

  const supabase = await createClient();
  const [events, { data: locations }] = await Promise.all([
    getEvents(),
    supabase.from("locations").select("id,name").eq("is_active", true).order("name"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Eventos</h1>
          <p className="text-muted-foreground">Workshops puntuales y ferias.</p>
        </div>
        {canEdit && <NewEventDialog locations={locations ?? []} />}
      </div>

      {events.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay eventos cargados.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Ubicación</TableHead>
              <TableHead>Cupo</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => {
              const registered = event.event_registrations
                .filter((r) => r.status === "registered")
                .reduce((sum, r) => sum + r.quantity, 0);
              return (
                <TableRow key={event.id}>
                  <TableCell>
                    <Link href={`/eventos/${event.id}`} className="font-medium hover:underline">
                      {event.name}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">{event.human_code}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.event_type === "fair" ? "Feria" : "Workshop"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(event.event_date)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.locations?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.capacity ? `${registered}/${event.capacity}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{EVENT_STATUS_LABELS[event.status]}</Badge>
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
