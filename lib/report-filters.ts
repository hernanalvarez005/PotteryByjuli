import { todayInArgentina } from "@/lib/format";
import type { DashboardFilters } from "@/lib/reports";

// Parseo de los filtros de la URL de /dashboard y /reportes (puro, sin Supabase): rango, unidades
// (lista separada por comas), ubicación y canal. Un valor inválido NUNCA rompe la pantalla: cae al
// default. "Todas" (sin parámetro) es `null`, nunca una lista vieja de ids.

export type ReportSearchParams = {
  from?: string;
  to?: string;
  business_units?: string;
  location?: string;
  channel?: string;
  models?: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validDate(v: string | undefined): string | null {
  if (!v || !DATE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** Lista de ids separados por comas: sólo uuids válidos, sin repetidos, hasta `max`. */
export function parseIdList(raw: string | undefined, max = 50): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (UUID.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

export function parseReportFilters(params: ReportSearchParams, defaults: DashboardFilters): DashboardFilters {
  let from = validDate(params.from) ?? defaults.from;
  let to = validDate(params.to) ?? defaults.to;
  if (from > to) [from, to] = [to, from];
  const units = parseIdList(params.business_units);
  return {
    from,
    to,
    businessUnitIds: units.length > 0 ? units : null,
    locationId: params.location && UUID.test(params.location) ? params.location : null,
    channelId: params.channel && UUID.test(params.channel) ? params.channel : null,
  };
}

/** Default de /reportes: lo que va del año (el "todo el histórico" se elige con el preset). */
export function defaultReportFilters(): DashboardFilters {
  const today = todayInArgentina();
  return { from: `${today.slice(0, 4)}-01-01`, to: today, businessUnitIds: null, locationId: null, channelId: null };
}

/**
 * La serie en el tiempo arranca en la primera actividad real (pedido, pago u otro ingreso), no en el
 * "desde" pedido: con "todo el histórico" (desde 2000) la serie mensual tendría cientos de meses en 0.
 */
export function seriesFrom(requestedFrom: string, firstActivity: string | null): string {
  return firstActivity && firstActivity > requestedFrom ? firstActivity : requestedFrom;
}
