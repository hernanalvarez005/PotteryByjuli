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

describe("getMixByChannel never re-introduces the ambiguous sales_channels embed", () => {
  it("names the exact FK — orders has two FKs to sales_channels (origin_channel_id, closing_channel_id)", () => {
    // Un embed `sales_channels(name)` sin nombrar la FK exacta falla con
    // PGRST201 ("more than one relationship was found") porque orders
    // tiene dos columnas que apuntan a sales_channels — Supabase no lo
    // reporta como excepción no controlada acá (el código sólo
    // desestructura `data`), así que el bug se manifestaba como "Sin
    // ventas en este período" en el donut de Canal, nunca como un error
    // visible. Reproducido y confirmado en vivo contra Supabase local
    // antes de este fix.
    const source = readFileSync(path.resolve(__dirname, "..", "lib/reports.ts"), "utf-8");
    expect(source).toMatch(/sales_channels!orders_closing_channel_id_fkey\(name\)/);
  });
});
