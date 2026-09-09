import { describe, it, expect } from "vitest";
import {
  entriesForDate,
  isoWeekday,
  startOfWeek,
  startOfMonth,
  monthGridDays,
  toIsoDate,
  type ClassSlot,
  type WorkshopEntry,
  type SpecialDateEntry,
} from "./calendar";

function classSlot(overrides: Partial<ClassSlot>): ClassSlot {
  return {
    kind: "class",
    id: "c1",
    weekday: 1,
    startTime: "18:00",
    endTime: "20:00",
    title: "Grupo",
    subtitle: "",
    enrolledCount: 0,
    href: "/talleres/c1",
    ...overrides,
  };
}

function workshop(overrides: Partial<WorkshopEntry>): WorkshopEntry {
  return {
    kind: "workshop",
    id: "w1",
    date: "2026-09-09",
    startTime: "15:00",
    title: "Workshop",
    subtitle: "",
    confirmedCount: 0,
    capacity: null,
    status: "published",
    href: "/eventos/w1",
    ...overrides,
  };
}

function special(overrides: Partial<SpecialDateEntry>): SpecialDateEntry {
  return { kind: "special", id: "s1", date: "2026-09-09", title: "Día especial", category: null, ...overrides };
}

describe("isoWeekday", () => {
  it("returns 1 for Monday and 7 for Sunday", () => {
    // 2026-09-07 is a Monday, 2026-09-13 is the following Sunday.
    expect(isoWeekday(new Date("2026-09-07T00:00:00Z"))).toBe(1);
    expect(isoWeekday(new Date("2026-09-13T00:00:00Z"))).toBe(7);
  });
});

describe("entriesForDate", () => {
  it("finds a recurring class by weekday, a workshop and a special date by exact date", () => {
    const entries = entriesForDate(
      [classSlot({ weekday: 3 })], // Wednesday
      [workshop({ date: "2026-09-09" })],
      [special({ date: "2026-09-09" })],
      "2026-09-09" // a Wednesday
    );
    expect(entries).toHaveLength(3);
  });

  it("excludes a class whose weekday doesn't match this date", () => {
    const entries = entriesForDate([classSlot({ weekday: 1 })], [], [], "2026-09-09"); // Wednesday
    expect(entries).toHaveLength(0);
  });

  it("sorts chronologically by start time", () => {
    const entries = entriesForDate(
      [classSlot({ weekday: 3, startTime: "18:00", id: "late" })],
      [workshop({ date: "2026-09-09", startTime: "09:00", id: "early" })],
      [],
      "2026-09-09"
    );
    expect(entries.map((e) => e.id)).toEqual(["early", "late"]);
  });

  it("respects the kind filter", () => {
    const entries = entriesForDate(
      [classSlot({ weekday: 3 })],
      [workshop({ date: "2026-09-09" })],
      [],
      "2026-09-09",
      "workshop"
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("workshop");
  });
});

describe("startOfMonth", () => {
  it("returns the 1st of the month, regardless of the day passed in", () => {
    expect(toIsoDate(startOfMonth(new Date("2026-09-17T00:00:00Z")))).toBe("2026-09-01");
  });
});

describe("monthGridDays", () => {
  it("starts on a Monday and ends on a Sunday, covering the whole month", () => {
    const days = monthGridDays(new Date("2026-09-17T00:00:00Z"));
    expect(isoWeekday(days[0])).toBe(1);
    expect(isoWeekday(days.at(-1)!)).toBe(7);
    expect(days.map(toIsoDate)).toContain("2026-09-01");
    expect(days.map(toIsoDate)).toContain("2026-09-30");
  });

  it("the grid length is always a multiple of 7 (whole weeks)", () => {
    expect(monthGridDays(new Date("2026-09-17T00:00:00Z")).length % 7).toBe(0);
  });
});

describe("startOfWeek (existing behavior, guarded here too)", () => {
  it("never returns a date after the input", () => {
    const monday = startOfWeek(new Date("2026-09-09T00:00:00Z")); // a Wednesday
    expect(toIsoDate(monday)).toBe("2026-09-07");
  });
});
