import { createClient } from "@/lib/supabase/server";

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

export type CalendarEntry = ClassSlot | WorkshopEntry | SpecialDateEntry;

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
