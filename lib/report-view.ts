import type { ReportKpis } from "@/lib/reports";

// Datos de presentación de los gráficos de /reportes (puro): nada de reglas de negocio acá — las
// definiciones viven en los RPC `report_*`. Esto sólo reacomoda lo que ya devolvió el servidor.

/** Etiqueta corta de un bucket de la serie: "2026-09" (mensual) → "09/26"; "2026-09-04" (diario) → "04/09". */
export function bucketLabel(bucket: string): string {
  const [year, month, day] = bucket.split("-");
  return day ? `${day}/${month}` : `${month}/${year.slice(2)}`;
}

export type CollectedVsPending = {
  collected: number;
  pending: number;
  overpaid: number;
  invoiced: number;
  collectedPct: number;
  pendingPct: number;
};

/**
 * "De lo que facturé en el período, ¿cuánto ya cobré y cuánto falta?". Sale de la cohorte de
 * `report_kpis` (identidad: facturación = cobrado − sobrepago + pendiente), así las dos barras suman
 * EXACTO la facturación. Los porcentajes son sobre la facturación (0 si no hubo).
 */
export function collectedVsPending(kpis: Pick<ReportKpis, "invoiced" | "cohortPaid" | "cohortOverpaid" | "cohortPending">): CollectedVsPending {
  const collected = Math.max(0, kpis.cohortPaid - kpis.cohortOverpaid);
  const pending = Math.max(0, kpis.cohortPending);
  const invoiced = kpis.invoiced;
  const pct = (n: number) => (invoiced > 0 ? Math.round((n / invoiced) * 1000) / 10 : 0);
  return { collected, pending, overpaid: Math.max(0, kpis.cohortOverpaid), invoiced, collectedPct: pct(collected), pendingPct: pct(pending) };
}

/** Cuántos modelos puede agrupar la selección libre (la URL la lleva: ids de 36 caracteres). */
export const MAX_SELECTED_MODELS = 30;

/** Búsqueda de modelos de la selección libre (client-safe: la usan el componente y el servidor). */
export const MODEL_SEARCH_MIN_CHARS = 2;
export const MODEL_SEARCH_LIMIT = 20;
