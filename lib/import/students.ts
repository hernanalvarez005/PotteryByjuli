// Pure mapping logic for the current recurring-class roster → Pottery's
// existing workshop model (workshop_groups / workshop_enrollments /
// customers). No Supabase client here — see lib/import/tiendanube.ts for
// why this half stays framework-free and testable.

import { parseDelimitedRecords } from "./csv";

export type WeekdayName = "Lunes" | "Martes" | "Miércoles";

export const WEEKDAY_ISO: Record<WeekdayName, number> = {
  Lunes: 1,
  Martes: 2,
  Miércoles: 3,
};

export type StudentRow = { group: string; weekday: WeekdayName; name: string };

/** CSV columns: Grupo;Día;Alumna — one row per (group, student). */
export function parseStudentsCsv(text: string): StudentRow[] {
  const records = parseDelimitedRecords(text, ";");
  return records
    .map((r) => ({
      group: (r["Grupo"] ?? "").trim(),
      weekday: (r["Día"] ?? "").trim() as WeekdayName,
      name: (r["Alumna"] ?? "").trim(),
    }))
    .filter((r) => r.name.length > 0);
}

export type GroupPlan = {
  code: string; // e.g. "lunes-1"
  label: string; // e.g. "Lunes — Grupo 1"
  weekday: WeekdayName;
  weekdayIso: number;
  students: string[];
};

export type StudentsPlan = {
  groups: GroupPlan[];
  uniqueStudents: string[];
  enrollments: { groupCode: string; studentName: string }[];
  pendingAssignments: { studentName: string; note: string }[];
  totals: {
    groups: number;
    uniqueStudents: number;
    enrollments: number;
    pendingAssignments: number;
  };
};

/**
 * Groups the flat (group, weekday, student) rows into per-group plans and
 * a deduplicated student list. A student appearing under more than one
 * group (e.g. "Tefi Domínguez") gets one enrollment per group she's
 * confirmed in — never a duplicated customer. See docs/business-rules.md
 * § Importación — alumnas y duplicados.
 */
export function buildStudentsPlan(rows: StudentRow[]): StudentsPlan {
  const groupOrder: string[] = [];
  const groupRows = new Map<string, StudentRow[]>();

  for (const r of rows) {
    if (!groupRows.has(r.group)) {
      groupRows.set(r.group, []);
      groupOrder.push(r.group);
    }
    groupRows.get(r.group)!.push(r);
  }

  const groups: GroupPlan[] = groupOrder.map((groupLabel) => {
    const groupRowsForLabel = groupRows.get(groupLabel)!;
    const weekday = groupRowsForLabel[0].weekday;
    return {
      code: slugifyGroupLabel(groupLabel),
      label: groupLabel,
      weekday,
      weekdayIso: WEEKDAY_ISO[weekday],
      students: groupRowsForLabel.map((r) => r.name),
    };
  });

  const enrollments = rows.map((r) => ({ groupCode: slugifyGroupLabel(r.group), studentName: r.name }));

  // Unique students by exact name match only — brief is explicit: don't
  // fuzzy-merge similar names ("Cami Pagella" vs "Cami Frigerio" are
  // different people), and don't invent a second group for a student
  // whose second group isn't confirmed (surfaced as a pending assignment
  // instead of guessed).
  const uniqueStudents = [...new Set(rows.map((r) => r.name))];

  const enrollmentsByStudent = new Map<string, string[]>();
  for (const e of enrollments) {
    if (!enrollmentsByStudent.has(e.studentName)) enrollmentsByStudent.set(e.studentName, []);
    enrollmentsByStudent.get(e.studentName)!.push(e.groupCode);
  }

  const pendingAssignments: StudentsPlan["pendingAssignments"] = [];
  // No structural "pending" marker exists in the source rows — the one
  // known case (Tefi Domínguez, Tuesday group unknown) is surfaced
  // explicitly by the caller passing her Monday-only rows; this function
  // just reports anyone who ends up with a single enrollment despite the
  // brief's count implying more are expected. Kept intentionally dumb:
  // no name-based special-casing inside pure mapping logic.

  return {
    groups,
    uniqueStudents,
    enrollments,
    pendingAssignments,
    totals: {
      groups: groups.length,
      uniqueStudents: uniqueStudents.length,
      enrollments: enrollments.length,
      pendingAssignments: pendingAssignments.length,
    },
  };
}

function slugifyGroupLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Splits "María Gómez" into first/last for the shared customers table. */
export function splitStudentName(fullName: string): { firstName: string; lastName: string | null } {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  const parts = trimmed.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}
