import { describe, it, expect } from "vitest";
import { dateOnlyToArgentinaNoonISO, todayInArgentina, formatDate, APP_TIMEZONE } from "./format";

// paid_at siempre explícito (sección 7 de la tanda de mejoras operativas)
// — el punto entero de construir el timestamp al mediodía Argentina es
// que un pago cargado con fecha real "2026-09-04" nunca aparezca
// atribuido al 03/09 o al 05/09 por un corrimiento de huso horario, sin
// importar en qué zona horaria corra el proceso que lo lee de vuelta.
describe("dateOnlyToArgentinaNoonISO", () => {
  it("never shifts the calendar day, read back in UTC", () => {
    const iso = dateOnlyToArgentinaNoonISO("2026-09-04");
    const readBackUTC = new Date(iso).toISOString().slice(0, 10);
    expect(readBackUTC).toBe("2026-09-04");
  });

  it("never shifts the calendar day, read back in Argentina time", () => {
    const iso = dateOnlyToArgentinaNoonISO("2026-09-04");
    expect(formatDate(iso)).toBe("04/09/2026");
  });

  // Noon Argentina (UTC-3) is 15:00 UTC — comfortably inside the same
  // calendar day for every timezone this app actually reads dates in
  // (the server process, typically UTC, and the Argentina-time display).
  // It is NOT a guarantee against literally any timezone on Earth — an
  // extreme reader far enough ahead of UTC (e.g. UTC+14) would still see
  // the next day, but nothing in this app ever reads a date that way.
  it("stays same-day for reasonable offsets around UTC (not just exactly UTC or ART)", () => {
    const iso = dateOnlyToArgentinaNoonISO("2026-09-04");
    for (const timeZone of ["America/New_York", "Europe/London", "Europe/Moscow"]) {
      const readBack = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
        new Date(iso)
      );
      expect(readBack).toBe("2026-09-04");
    }
  });

  it("crosses a month/year boundary correctly", () => {
    expect(new Date(dateOnlyToArgentinaNoonISO("2026-12-31")).toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(new Date(dateOnlyToArgentinaNoonISO("2027-01-01")).toISOString().slice(0, 10)).toBe("2027-01-01");
  });
});

describe("todayInArgentina", () => {
  it("returns a well-formed YYYY-MM-DD string", () => {
    expect(todayInArgentina()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("matches what Intl reports for America/Argentina/Buenos_Aires right now", () => {
    const expected = new Intl.DateTimeFormat("en-CA", {
      timeZone: APP_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(todayInArgentina()).toBe(expected);
  });
});
