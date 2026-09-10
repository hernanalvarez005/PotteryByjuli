/**
 * Argentina locale helpers (section 61 of the spec): ARS currency,
 * DD/MM/YYYY dates, America/Argentina/Buenos_Aires timezone.
 * Store timestamps in UTC (as Postgres `timestamptz` already does) and only
 * format to local time at the edge, here.
 */
export const APP_TIMEZONE = "America/Argentina/Buenos_Aires";

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: APP_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: APP_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

export function formatDate(value: string | Date): string {
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
  return dateTimeFormatter.format(new Date(value));
}

const isoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date (YYYY-MM-DD) in Argentina time — the default a payment-date input should start on. */
export function todayInArgentina(): string {
  return isoDateFormatter.format(new Date());
}

/**
 * A date-only input (YYYY-MM-DD, no time) needs to become a real
 * `timestamptz` without ever risking a UTC day-shift. Fixing the time at
 * noon Argentina (UTC-3) keeps it solidly inside the same calendar day no
 * matter which timezone reads it back — midnight would be the one time
 * of day a naive local→UTC conversion could push to the previous or next
 * day. Used wherever a form only asks for a date (never a time) but the
 * column underneath is a timestamptz — e.g. `payments.paid_at`.
 */
export function dateOnlyToArgentinaNoonISO(dateOnly: string): string {
  return `${dateOnly}T12:00:00-03:00`;
}

/** Start of a calendar day in Argentina time, as a real timestamptz-ready ISO string. */
export function dateOnlyToArgentinaStartOfDayISO(dateOnly: string): string {
  return `${dateOnly}T00:00:00-03:00`;
}

/** End of a calendar day (inclusive) in Argentina time, as a real timestamptz-ready ISO string. */
export function dateOnlyToArgentinaEndOfDayISO(dateOnly: string): string {
  return `${dateOnly}T23:59:59.999-03:00`;
}
