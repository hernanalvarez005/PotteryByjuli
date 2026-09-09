import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import {
  getWeeklyClasses,
  getWorkshopsInRange,
  getSpecialDatesInRange,
  entriesForDate,
  startOfWeek,
  startOfMonth,
  monthGridDays,
  toIsoDate,
  addDays,
  isoWeekday,
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
type ViewMode = "day" | "week" | "month";
const VIEWS: { value: ViewMode; label: string }[] = [
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
];

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; week?: string; date?: string; month?: string; filter?: string }>;
}) {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations") || hasRole(user, "workshop_staff");
  const params = await searchParams;
  const filter = (params.filter ?? "all") as "all" | "class" | "workshop" | "special";
  const view: ViewMode = params.view === "day" || params.view === "month" ? params.view : "week";
  const todayIso = toIsoDate(new Date());

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendario</h1>
          <p className="text-muted-foreground">Clases, workshops y fechas especiales.</p>
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
        <div className="flex gap-1">
          {VIEWS.map((v) => (
            <Link key={v.value} href={`/calendario?view=${v.value}&filter=${filter}`}>
              <Badge variant={view === v.value ? "secondary" : "outline"} className="cursor-pointer">
                {v.label}
              </Badge>
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Link key={f.value} href={`/calendario?view=${view}&filter=${f.value}`}>
              <Badge variant={filter === f.value ? "secondary" : "outline"} className="cursor-pointer">
                {f.label}
              </Badge>
            </Link>
          ))}
        </div>
      </div>

      {view === "day" && <DayView dateParam={params.date} filter={filter} todayIso={todayIso} />}
      {view === "week" && <WeekView weekParam={params.week} filter={filter} todayIso={todayIso} />}
      {view === "month" && <MonthView monthParam={params.month} filter={filter} todayIso={todayIso} />}
    </div>
  );
}

async function loadRange(startIso: string, endIso: string) {
  const [classes, workshops, specialDates] = await Promise.all([
    getWeeklyClasses(),
    getWorkshopsInRange(startIso, endIso),
    getSpecialDatesInRange(startIso, endIso),
  ]);
  return { classes, workshops, specialDates };
}

async function DayView({
  dateParam,
  filter,
  todayIso,
}: {
  dateParam?: string;
  filter: "all" | "class" | "workshop" | "special";
  todayIso: string;
}) {
  const dateIso = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayIso;
  const { classes, workshops, specialDates } = await loadRange(dateIso, dateIso);
  const entries = entriesForDate(classes, workshops, specialDates, dateIso, filter);

  const date = new Date(`${dateIso}T00:00:00Z`);
  const prevIso = toIsoDate(addDays(date, -1));
  const nextIso = toIsoDate(addDays(date, 1));
  const label = `${DAY_LABELS[isoWeekday(date) - 1]} ${dateIso.slice(8, 10)}/${dateIso.slice(5, 7)}/${dateIso.slice(0, 4)}`;

  return (
    <div className="flex flex-col gap-4">
      <NavBar
        prevHref={`/calendario?view=day&date=${prevIso}&filter=${filter}`}
        todayHref={`/calendario?view=day&filter=${filter}`}
        nextHref={`/calendario?view=day&date=${nextIso}&filter=${filter}`}
        label={label}
      />
      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Sin actividad este día.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => (
            <AgendaRow key={`${entry.kind}-${entry.id}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

async function WeekView({
  weekParam,
  filter,
  todayIso,
}: {
  weekParam?: string;
  filter: "all" | "class" | "workshop" | "special";
  todayIso: string;
}) {
  const anchor = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? new Date(`${weekParam}T00:00:00Z`) : new Date();
  const monday = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const weekStartIso = toIsoDate(monday);
  const weekEndIso = toIsoDate(days[6]);

  const { classes, workshops, specialDates } = await loadRange(weekStartIso, weekEndIso);
  const entriesByDay = days.map((day) => {
    const iso = toIsoDate(day);
    return { iso, entries: entriesForDate(classes, workshops, specialDates, iso, filter) };
  });

  const prevWeekIso = toIsoDate(addDays(monday, -7));
  const nextWeekIso = toIsoDate(addDays(monday, 7));

  return (
    <div className="flex flex-col gap-4">
      <NavBar
        prevHref={`/calendario?view=week&week=${prevWeekIso}&filter=${filter}`}
        todayHref={`/calendario?view=week&filter=${filter}`}
        nextHref={`/calendario?view=week&week=${nextWeekIso}&filter=${filter}`}
        label={`${weekStartIso} – ${weekEndIso}`}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-7">
        {entriesByDay.map(({ iso, entries }, i) => (
          <div
            key={iso}
            className={`flex flex-col gap-2 rounded-lg border p-3 ${iso === todayIso ? "border-primary bg-secondary/40" : "border-border bg-card"}`}
          >
            <Link href={`/calendario?view=day&date=${iso}&filter=${filter}`} className="hover:underline">
              <p className="text-sm font-medium text-foreground">
                {DAY_LABELS[i]} <span className="text-muted-foreground">{iso.slice(8, 10)}/{iso.slice(5, 7)}</span>
              </p>
            </Link>
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

async function MonthView({
  monthParam,
  filter,
  todayIso,
}: {
  monthParam?: string;
  filter: "all" | "class" | "workshop" | "special";
  todayIso: string;
}) {
  const anchor = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? new Date(`${monthParam}-01T00:00:00Z`) : new Date();
  const firstOfMonth = startOfMonth(anchor);
  const gridDays = monthGridDays(anchor);
  const gridStartIso = toIsoDate(gridDays[0]);
  const gridEndIso = toIsoDate(gridDays.at(-1)!);
  const monthLabel = firstOfMonth.toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
  const currentMonthIso = `${firstOfMonth.getUTCFullYear()}-${String(firstOfMonth.getUTCMonth() + 1).padStart(2, "0")}`;

  const { classes, workshops, specialDates } = await loadRange(gridStartIso, gridEndIso);
  const daysWithEntries = gridDays.map((day) => {
    const iso = toIsoDate(day);
    return {
      iso,
      inMonth: day.getUTCMonth() === firstOfMonth.getUTCMonth(),
      entries: entriesForDate(classes, workshops, specialDates, iso, filter),
    };
  });

  const prevMonth = new Date(Date.UTC(firstOfMonth.getUTCFullYear(), firstOfMonth.getUTCMonth() - 1, 1));
  const nextMonth = new Date(Date.UTC(firstOfMonth.getUTCFullYear(), firstOfMonth.getUTCMonth() + 1, 1));
  const prevMonthIso = `${prevMonth.getUTCFullYear()}-${String(prevMonth.getUTCMonth() + 1).padStart(2, "0")}`;
  const nextMonthIso = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-4">
      <NavBar
        prevHref={`/calendario?view=month&month=${prevMonthIso}&filter=${filter}`}
        todayHref={`/calendario?view=month&filter=${filter}`}
        nextHref={`/calendario?view=month&month=${nextMonthIso}&filter=${filter}`}
        label={`${monthLabel.charAt(0).toUpperCase()}${monthLabel.slice(1)}`}
      />
      <div className="grid grid-cols-7 gap-2 text-xs text-muted-foreground">
        {DAY_LABELS.map((label) => (
          <div key={label} className="hidden text-center font-medium md:block">
            {label.slice(0, 3)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
        {daysWithEntries.map(({ iso, inMonth, entries }) => {
          const classCount = entries.filter((e) => e.kind === "class").length;
          const workshopCount = entries.filter((e) => e.kind === "workshop").length;
          const specialCount = entries.filter((e) => e.kind === "special").length;
          return (
            <Link
              key={iso}
              href={`/calendario?view=day&date=${iso}&filter=${filter}`}
              className={`flex min-h-16 flex-col gap-1 rounded-md border p-2 hover:bg-accent/50 ${
                iso === todayIso ? "border-primary bg-secondary/40" : "border-border bg-card"
              } ${inMonth ? "" : "opacity-40"}`}
            >
              <span className="text-xs font-medium">{Number(iso.slice(8, 10))}</span>
              <div className="flex flex-wrap gap-1">
                {classCount > 0 && (
                  <span className="rounded bg-secondary px-1 text-[10px] text-secondary-foreground">
                    {classCount} clase{classCount > 1 ? "s" : ""}
                  </span>
                )}
                {workshopCount > 0 && (
                  <span className="rounded bg-primary/15 px-1 text-[10px] text-foreground">
                    {workshopCount} workshop{workshopCount > 1 ? "s" : ""}
                  </span>
                )}
                {specialCount > 0 && (
                  <span className="rounded bg-pottery-clay/15 px-1 text-[10px] text-foreground">
                    {specialCount} fecha{specialCount > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Mes: {currentMonthIso} — click en un día para ver el detalle.</p>
    </div>
  );
}

function NavBar({
  prevHref,
  todayHref,
  nextHref,
  label,
}: {
  prevHref: string;
  todayHref: string;
  nextHref: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <Link href={prevHref}>
        <Button size="icon" variant="outline">
          <ChevronLeft className="size-4" />
        </Button>
      </Link>
      <Link href={todayHref}>
        <Button size="sm" variant="outline">
          Hoy
        </Button>
      </Link>
      <Link href={nextHref}>
        <Button size="icon" variant="outline">
          <ChevronRight className="size-4" />
        </Button>
      </Link>
      <span className="ml-2 text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

function AgendaRow({ entry }: { entry: CalendarEntry }) {
  if (entry.kind === "class") {
    return (
      <Link
        href={entry.href}
        className="flex items-center gap-3 rounded-md border border-secondary bg-secondary px-3 py-2 text-sm text-secondary-foreground hover:bg-secondary/70"
      >
        <span className="w-12 shrink-0 font-medium">{entry.startTime?.slice(0, 5) ?? "—"}</span>
        <span className="flex-1">{entry.title}</span>
        <span className="text-muted-foreground">{entry.enrolledCount} alumnos</span>
      </Link>
    );
  }
  if (entry.kind === "workshop") {
    return (
      <Link
        href={entry.href}
        className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground hover:bg-primary/15"
      >
        <span className="w-12 shrink-0 font-medium">{entry.startTime?.slice(0, 5) ?? "—"}</span>
        <span className="flex-1">{entry.title}</span>
        <span className="text-muted-foreground">
          {entry.subtitle} {entry.capacity != null ? `· ${entry.confirmedCount}/${entry.capacity}` : ""}
        </span>
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-md border border-pottery-clay/30 bg-pottery-clay/15 px-3 py-2 text-sm text-foreground">
      <span className="w-12 shrink-0 font-medium">—</span>
      <span className="flex-1">{entry.title}</span>
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
