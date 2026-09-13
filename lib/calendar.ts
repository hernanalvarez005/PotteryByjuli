import { createClient } from "@/lib/supabase/server";
import { customerDisplayName } from "@/lib/customers-shared";

export type ClassSlot = {
  kind: "class";
  id: string;
  weekday: number; // 1=Monday..7=Sunday
  startTime: string | null;
  endTime: string | null;
  title: string;
  subtitle: string;
  enrolledCount: number;
  href: string;
};

export type WorkshopEntry = {
  kind: "workshop";
  id: string;
  date: string; // yyyy-mm-dd
  startTime: string | null;
  title: string;
  subtitle: string;
  confirmedCount: number;
  capacity: number | null;
  status: string;
  href: string;
};

export type SpecialDateEntry = {
  kind: "special";
  id: string;
  date: string;
  title: string;
  category: string | null;
};

/** Un pedido (encargo/personalizado, nunca una venta minorista — esas
 * nunca tienen estimated_date) con fecha de entrega estimada. Sólo
 * trabajo activo: un pedido ya entregado o cancelado no tiene sentido
 * en un calendario de "qué falta entregar" (Bloque 7). */
export type OrderDeliveryEntry = {
  kind: "order";
  id: string;
  date: string;
  title: string;
  subtitle: string;
  status: string;
  href: string;
};

/** Recordatorio (Bloque 7) — opcionalmente vinculado a una fecha
 * especial, nunca la duplica: sólo guarda su id. */
export type ReminderEntry = {
  kind: "reminder";
  id: string;
  date: string;
  title: string;
  status: "pending" | "completed";
  specialDateId: string | null;
  /** Fecha especial vinculada, para el link corto — null si no vincula ninguna. */
  linkedSpecialDate: { title: string; date: string } | null;
};

export type CalendarEntry = ClassSlot | WorkshopEntry | SpecialDateEntry | OrderDeliveryEntry | ReminderEntry;

/** Recurring classes (weekday+time already set) — one row per group, reused every week. */
export async function getWeeklyClasses(): Promise<ClassSlot[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workshop_groups")
    .select(
      "id,name,weekday,start_time,end_time,is_active,archived_at,workshop_programs(name),locations(name),workshop_enrollments(status)"
    )
    .eq("is_active", true)
    .is("archived_at", null)
    .not("weekday", "is", null);

  return (data ?? []).map((g) => {
    const program = g.workshop_programs as unknown as { name: string } | null;
    const location = g.locations as unknown as { name: string } | null;
    const enrollments = (g.workshop_enrollments ?? []) as { status: string }[];
    return {
      kind: "class" as const,
      id: g.id,
      weekday: g.weekday as number,
      startTime: g.start_time,
      endTime: g.end_time,
      title: g.name,
      subtitle: [program?.name, location?.name].filter(Boolean).join(" · "),
      enrolledCount: enrollments.filter((e) => e.status === "active").length,
      href: `/talleres/${g.id}`,
    };
  });
}

/** Workshops/fairs whose event_date falls within [startDate, endDate] (inclusive, yyyy-mm-dd). */
export async function getWorkshopsInRange(startDate: string, endDate: string): Promise<WorkshopEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("id,name,event_date,start_time,capacity,status,locations(name),event_registrations(quantity,status)")
    .gte("event_date", startDate)
    .lte("event_date", endDate)
    .is("archived_at", null)
    .neq("status", "cancelled");

  return (data ?? []).map((e) => {
    const location = e.locations as unknown as { name: string } | null;
    const registrations = (e.event_registrations ?? []) as { quantity: number; status: string }[];
    const confirmed = registrations
      .filter((r) => r.status === "confirmed" || r.status === "attended")
      .reduce((sum, r) => sum + r.quantity, 0);
    return {
      kind: "workshop" as const,
      id: e.id,
      date: e.event_date,
      startTime: e.start_time,
      title: e.name,
      subtitle: location?.name ?? "",
      confirmedCount: confirmed,
      capacity: e.capacity,
      status: e.status,
      href: `/eventos/${e.id}`,
    };
  });
}

/** Special dates in [startDate, endDate] — recurring ones matched by month/day regardless of year. */
export async function getSpecialDatesInRange(
  startDate: string,
  endDate: string
): Promise<SpecialDateEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("special_dates").select("id,title,date,category,recurs_yearly");

  const start = new Date(startDate);
  const end = new Date(endDate);
  const result: SpecialDateEntry[] = [];

  for (const row of data ?? []) {
    const original = new Date(row.date);
    if (!row.recurs_yearly) {
      if (row.date >= startDate && row.date <= endDate) {
        result.push({ kind: "special", id: row.id, date: row.date, title: row.title, category: row.category });
      }
      continue;
    }
    // Recurring: check this occurrence in every year the range touches.
    for (let year = start.getFullYear(); year <= end.getFullYear(); year++) {
      const occurrence = new Date(Date.UTC(year, original.getUTCMonth(), original.getUTCDate()));
      const iso = occurrence.toISOString().slice(0, 10);
      if (iso >= startDate && iso <= endDate) {
        result.push({ kind: "special", id: `${row.id}:${year}`, date: iso, title: row.title, category: row.category });
      }
    }
  }

  return result;
}

/** Pedidos (nunca ventas — operation_type='order' explícito, Bloque 2)
 * con estimated_date en [startDate, endDate], excluyendo los ya
 * entregados o cancelados: eso ya pasó, no es "trabajo por hacer". */
export async function getOrderDeliveriesInRange(startDate: string, endDate: string): Promise<OrderDeliveryEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id,human_code,estimated_date,status,customers(first_name,last_name)")
    .eq("operation_type", "order")
    .not("status", "in", "(delivered,cancelled)")
    .not("estimated_date", "is", null)
    .gte("estimated_date", startDate)
    .lte("estimated_date", endDate);

  return (data ?? []).map((o) => {
    const customer = o.customers as unknown as { first_name: string; last_name: string | null } | null;
    return {
      kind: "order" as const,
      id: o.id,
      date: o.estimated_date as string,
      title: o.human_code,
      subtitle: customer ? customerDisplayName(customer) : "Sin cliente",
      status: o.status,
      href: `/pedidos/${o.id}`,
    };
  });
}

/** Recordatorios con remind_at en [startDate, endDate]. */
export async function getRemindersInRange(startDate: string, endDate: string): Promise<ReminderEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("calendar_reminders")
    .select("id,title,remind_at,status,special_date_id,special_dates(title,date)")
    .gte("remind_at", startDate)
    .lte("remind_at", endDate);

  return (data ?? []).map((r) => {
    const linked = r.special_dates as unknown as { title: string; date: string } | null;
    return {
      kind: "reminder" as const,
      id: r.id,
      date: r.remind_at,
      title: r.title,
      status: r.status as "pending" | "completed",
      specialDateId: r.special_date_id,
      linkedSpecialDate: linked,
    };
  });
}

/** Monday of the week containing `date` (ISO 8601 week start). */
export function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sunday..6=Saturday
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** ISO weekday (1=Monday..7=Sunday) for a UTC-midnight Date. */
export function isoWeekday(d: Date): number {
  return ((d.getUTCDay() + 6) % 7) + 1;
}

function entryTime(e: CalendarEntry): string {
  if (e.kind === "class") return e.startTime ?? "99:99";
  if (e.kind === "workshop") return e.startTime ?? "99:99";
  // special/order/reminder son eventos de todo el día — se muestran
  // primero, antes que cualquier horario puntual.
  return "00:00";
}

/**
 * Every entry that falls on one specific date, sorted chronologically —
 * the one piece shared by the day/week/month views (each just picks which
 * dates to call this for) so "what happens on 2026-09-09" is computed in
 * exactly one place, pure and testable, no matter which view asked.
 */
export function entriesForDate(
  classes: ClassSlot[],
  workshops: WorkshopEntry[],
  specialDates: SpecialDateEntry[],
  orderDeliveries: OrderDeliveryEntry[],
  reminders: ReminderEntry[],
  dateIso: string,
  filter: "all" | "class" | "workshop" | "special" | "order" | "reminder" = "all"
): CalendarEntry[] {
  const weekday = isoWeekday(new Date(`${dateIso}T00:00:00Z`));
  const entries: CalendarEntry[] = [
    ...classes.filter((c) => c.weekday === weekday),
    ...workshops.filter((w) => w.date === dateIso),
    ...specialDates.filter((s) => s.date === dateIso),
    ...orderDeliveries.filter((o) => o.date === dateIso),
    ...reminders.filter((r) => r.date === dateIso),
  ];
  const filtered = filter === "all" ? entries : entries.filter((e) => e.kind === filter);
  return filtered.sort((a, b) => entryTime(a).localeCompare(entryTime(b)));
}

/** First day (UTC midnight) of the month containing `date`. */
export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** All calendar days to render for a month grid, Monday-first, including
 * the leading/trailing days from adjacent months that fill the grid. */
export function monthGridDays(monthStart: Date): Date[] {
  const firstOfMonth = startOfMonth(monthStart);
  const gridStart = startOfWeek(firstOfMonth);
  const lastOfMonth = new Date(Date.UTC(firstOfMonth.getUTCFullYear(), firstOfMonth.getUTCMonth() + 1, 0));
  const gridEnd = addDays(startOfWeek(lastOfMonth), 6);

  const days: Date[] = [];
  let cursor = gridStart;
  while (cursor <= gridEnd) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}
