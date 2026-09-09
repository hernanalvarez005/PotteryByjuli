import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import {
  getWeeklyClasses,
  getWorkshopsInRange,
  getSpecialDatesInRange,
  startOfWeek,
  toIsoDate,
  addDays,
  type CalendarEntry,
} from "@/lib/calendar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NewSpecialDateDialog } from "./new-special-date-dialog";

const DAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const FILTERS = [
  { value: "all", label: "Todos" },
  { value: "class", label: "Clases" },
  { value: "workshop", label: "Workshops" },
  { value: "special", label: "Fechas especiales" },
];

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; filter?: string }>;
}) {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations") || hasRole(user, "workshop_staff");
  const { week, filter = "all" } = await searchParams;

  const anchor = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? new Date(`${week}T00:00:00Z`) : new Date();
  const monday = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const weekStartIso = toIsoDate(monday);
  const weekEndIso = toIsoDate(days[6]);

  const [classes, workshops, specialDates] = await Promise.all([
    getWeeklyClasses(),
    getWorkshopsInRange(weekStartIso, weekEndIso),
    getSpecialDatesInRange(weekStartIso, weekEndIso),
  ]);

  const entriesByDay = days.map((day) => {
    const iso = toIsoDate(day);
    const weekday = ((day.getUTCDay() + 6) % 7) + 1; // 1=Monday..7=Sunday
    const dayEntries: CalendarEntry[] = [
      ...classes.filter((c) => c.weekday === weekday),
      ...workshops.filter((w) => w.date === iso),
      ...specialDates.filter((s) => s.date === iso),
    ].sort((a, b) => {
      const timeOf = (e: CalendarEntry) =>
        e.kind === "class" ? (e.startTime ?? "99:99") : e.kind === "workshop" ? (e.startTime ?? "99:99") : "00:00";
      return timeOf(a).localeCompare(timeOf(b));
    });
    return { date: day, iso, entries: filter === "all" ? dayEntries : dayEntries.filter((e) => e.kind === filter) };
  });

  const prevWeekIso = toIsoDate(addDays(monday, -7));
  const nextWeekIso = toIsoDate(addDays(monday, 7));
  const todayIso = toIsoDate(new Date());

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendario</h1>
          <p className="text-muted-foreground">
            Clases, workshops y fechas especiales de la semana.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Link href="/eventos">
              <Button size="sm" variant="outline">
                <Plus className="size-4" />
                Nuevo workshop
              </Button>
            </Link>
            <NewSpecialDateDialog />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link href={`/calendario?week=${prevWeekIso}&filter=${filter}`}>
            <Button size="icon" variant="outline">
              <ChevronLeft className="size-4" />
            </Button>
          </Link>
          <Link href={`/calendario?filter=${filter}`}>
            <Button size="sm" variant="outline">
              Hoy
            </Button>
          </Link>
          <Link href={`/calendario?week=${nextWeekIso}&filter=${filter}`}>
            <Button size="icon" variant="outline">
              <ChevronRight className="size-4" />
            </Button>
          </Link>
          <span className="ml-2 text-sm text-muted-foreground">
            {weekStartIso} – {weekEndIso}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Link key={f.value} href={`/calendario?week=${weekStartIso}&filter=${f.value}`}>
              <Badge variant={filter === f.value ? "secondary" : "outline"} className="cursor-pointer">
                {f.label}
              </Badge>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-7">
        {entriesByDay.map(({ iso, entries }, i) => (
          <div
            key={iso}
            className={`flex flex-col gap-2 rounded-lg border p-3 ${iso === todayIso ? "border-primary bg-secondary/40" : "border-border bg-card"}`}
          >
            <p className="text-sm font-medium text-foreground">
              {DAY_LABELS[i]} <span className="text-muted-foreground">{iso.slice(8, 10)}/{iso.slice(5, 7)}</span>
            </p>
            {entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin actividad</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {entries.map((entry) => (
                  <CalendarChip key={`${entry.kind}-${entry.id}`} entry={entry} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarChip({ entry }: { entry: CalendarEntry }) {
  if (entry.kind === "class") {
    return (
      <Link
        href={entry.href}
        className="block rounded-md border border-secondary bg-secondary px-2 py-1.5 text-xs text-secondary-foreground hover:bg-secondary/70"
      >
        <p className="font-medium">
          {entry.startTime?.slice(0, 5)} {entry.title}
        </p>
        <p className="text-muted-foreground">{entry.enrolledCount} alumnos</p>
      </Link>
    );
  }
  if (entry.kind === "workshop") {
    return (
      <Link
        href={entry.href}
        className="block rounded-md border border-primary/30 bg-primary/10 px-2 py-1.5 text-xs text-foreground hover:bg-primary/15"
      >
        <p className="font-medium">
          {entry.startTime?.slice(0, 5)} {entry.title}
        </p>
        <p className="text-muted-foreground">
          {entry.subtitle} {entry.capacity != null ? `· ${entry.confirmedCount}/${entry.capacity}` : ""}
        </p>
      </Link>
    );
  }
  return (
    <div className="rounded-md border border-pottery-clay/30 bg-pottery-clay/15 px-2 py-1.5 text-xs text-foreground">
      <p className="font-medium">{entry.title}</p>
    </div>
  );
}
