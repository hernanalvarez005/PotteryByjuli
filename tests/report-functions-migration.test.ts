import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Guardia estática de la migración "report_functions" (20261018110000): las definiciones oficiales
// viven en un solo lugar y las funciones son de SOLO LECTURA con ACL explícita. El comportamiento
// real lo prueban los tests de integración (lib/reports-definitions.integration.test.ts).
const SQL = readFileSync(path.resolve(__dirname, "../supabase/migrations/20261018110000_report_functions.sql"), "utf-8");
const code = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

const FUNCTIONS = [
  "report_orders_in_scope", "report_collections_in_scope", "report_kpis", "report_time_series",
  "report_by_business_unit", "report_by_channel", "report_top_products", "report_units_sold_selection",
  "report_production_counts", "report_wholesale_conversion",
];

function definitionOf(name: string): string {
  const start = code.search(new RegExp(`create function public\\.${name}\\(`));
  expect(start, `no se encontró ${name}`).toBeGreaterThanOrEqual(0);
  const end = code.indexOf("$$;", code.indexOf("as $$", start));
  return code.slice(start, end + 3);
}

describe("migración de funciones de reportes", () => {
  it("son exactamente las 10 funciones esperadas", () => {
    const created = [...code.matchAll(/create function public\.(\w+)\(/g)].map((m) => m[1]);
    expect(created.sort()).toEqual([...FUNCTIONS].sort());
  });

  it("todas: SQL, STABLE (sólo lectura), SECURITY INVOKER (la RLS de lectura aplica) y search_path fijo", () => {
    for (const name of FUNCTIONS) {
      const def = definitionOf(name);
      expect(def, name).toMatch(/language sql/);
      expect(def, name).toMatch(/\bstable\b/);
      expect(def, name).not.toMatch(/security definer/);
      expect(def, name).toMatch(/set search_path = public, pg_temp/);
      expect(def, name).not.toMatch(/\b(insert|update|delete)\b\s+(into|from)?\s*public\./i);
    }
  });

  it("ACL explícita: revoke all desde PUBLIC/anon/authenticated/service_role y EXECUTE sólo a authenticated", () => {
    const revokes = code.match(/revoke all on function public\.\w+\([^)]*\)\s+from public, anon, authenticated, service_role;/g) ?? [];
    expect(revokes).toHaveLength(FUNCTIONS.length);
    const grants = (code.match(/grant execute on function [^;]*;/gi) ?? []).map((g) => g.replace(/\s+/g, " "));
    expect(grants).toHaveLength(FUNCTIONS.length);
    for (const g of grants) expect(g).toMatch(/to authenticated;$/);
    for (const g of code.match(/grant [^;]*;/gi) ?? []) expect(g).not.toMatch(/\bto\b[^;]*\b(public|anon)\b/i);
  });

  it("UNA sola definición de facturación: todos los reportes de pedidos salen de report_orders_in_scope", () => {
    for (const name of ["report_kpis", "report_time_series", "report_by_business_unit", "report_by_channel", "report_top_products", "report_units_sold_selection"]) {
      expect(definitionOf(name), name).toMatch(/report_orders_in_scope\(/);
    }
    const scope = definitionOf("report_orders_in_scope");
    expect(scope).toMatch(/o\.status <> 'cancelled'/);
    expect(scope).toMatch(/o\.sale_date between p_from and p_to/);
  });

  it("UNA sola definición de cobrado: la caja sale de report_collections_in_scope, por paid_at en hora Argentina", () => {
    for (const name of ["report_kpis", "report_time_series"]) expect(definitionOf(name), name).toMatch(/report_collections_in_scope\(/);
    const scope = definitionOf("report_collections_in_scope");
    expect(scope).toMatch(/at time zone 'America\/Argentina\/Buenos_Aires'/);
    expect(scope).not.toMatch(/at time zone 'UTC'/i);
    // El límite superior es EXCLUSIVO (< día siguiente): nunca un "<= fin de día" con milisegundos.
    expect(scope).toMatch(/p\.paid_at < b\.t1/);
    expect(scope).toMatch(/o\.status <> 'cancelled'/);
  });

  it("talleres y otros ingresos sólo con sus reglas de inclusión (unidad classes / 'todas', sin canal)", () => {
    const scope = definitionOf("report_collections_in_scope");
    expect(scope).toMatch(/b\.classes_id = any\(p_business_unit_ids\)/);
    expect(scope.match(/p_channel_id is null\b(?! or)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(scope).toMatch(/where p_business_unit_ids is null\s+and p_channel_id is null/);
  });

  it("el pendiente sale de order_balances (misma fuente que get_orders_receivable) y la serie no se topea", () => {
    const kpis = definitionOf("report_kpis");
    expect(kpis).toMatch(/public\.order_balances/);
    expect(kpis).toMatch(/b\.operation_type = 'order'/);
    expect(definitionOf("report_time_series")).toMatch(/generate_series/);
  });

  it("la selección libre parte de las variantes ELEGIDAS (vendieron o no) y no devuelve nada sin selección", () => {
    const def = definitionOf("report_units_sold_selection");
    expect(def).toMatch(/coalesce\(p_variant_ids, '\{\}'::uuid\[\]\)/);
    expect(def).toMatch(/left join sold sd/);
  });
});
