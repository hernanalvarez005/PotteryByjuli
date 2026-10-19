import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Dos regresiones reales encontradas y corregidas durante la
// verificación manual de la sección 8 (dashboard con filtros) — se
// confirman estáticamente porque ambas son errores de composición de
// query (parámetros por default, embed ambiguo de PostgREST) que un test
// de lógica pura no hubiera detectado, y un test en vivo ya las
// reprodujo una vez en el navegador local.

describe("getTopProducts/getSalesByBusinessUnit on /reportes never silently narrow to 'this month'", () => {
  it("reportes/page.tsx passes allTimeDashboardFilters explicitly — never calls them bare", () => {
    // getTopProducts()/getSalesByBusinessUnit() sin argumentos ahora
    // caen en defaultDashboardFilters() (el mes actual, para el
    // dashboard) — /reportes dice explícitamente "todo el histórico, no
    // sólo el mes actual" y se rompería en silencio si volviera a
    // llamarlas sin filtro.
    const source = readFileSync(
      path.resolve(__dirname, "..", "app/(app)/reportes/page.tsx"),
      "utf-8"
    );
    expect(source).toMatch(/getTopProducts\(allTime\)/);
    expect(source).toMatch(/getSalesByBusinessUnit\(allTime\)/);
    expect(source).toMatch(/allTimeDashboardFilters/);
  });
});

describe("el mix por canal agrupa SIEMPRE por el canal de CIERRE (orders tiene dos FKs a sales_channels)", () => {
  it("report_by_channel une sales_channels por closing_channel_id — nunca origin_channel_id", () => {
    // `orders` tiene origin_channel_id y closing_channel_id. Antes un embed `sales_channels(name)` sin
    // nombrar la FK fallaba con PGRST201 y el donut decía "Sin ventas" sin ningún error visible. Ahora el
    // mix lo calcula Postgres (migración 20261018110000): la ambigüedad desaparece, pero el canal que
    // cuenta sigue siendo el de cierre, y el filtro de canal del dashboard también.
    const sql = readFileSync(path.resolve(__dirname, "..", "supabase/migrations/20261018110000_report_functions.sql"), "utf-8");
    const start = sql.indexOf("create function public.report_by_channel(");
    const def = sql.slice(start, sql.indexOf("$$;", sql.indexOf("as $$", start)));
    expect(def).toMatch(/left join public\.sales_channels sc on sc\.id = s\.closing_channel_id/);
    expect(def).not.toMatch(/origin_channel_id/);
  });

  it("lib/reports.ts ya no arma embeds de PostgREST ni suma filas de orders/payments/order_items en JS", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "lib/reports.ts"), "utf-8");
    expect(source).not.toMatch(/sales_channels\(/);
    expect(source).not.toMatch(/\.from\("order_items"\)/);
    expect(source).not.toMatch(/\.from\("payments"\)\s*\.select\("amount/);
  });
});
