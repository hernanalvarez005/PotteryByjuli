import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Guardia estática del hardening de las funciones SECURITY DEFINER de la migración
// "modify_order" (20261010090000): cada una fija su search_path (con pg_temp al final),
// parte de una ACL vacía (`revoke all ... from public, anon, authenticated, service_role`) y
// concede EXECUTE sólo a roles autenticados — nunca a PUBLIC ni a anon. El comportamiento real
// (anon / authenticated / service_role contra cada función) lo prueban los tests de integración;
// esto evita que una edición futura de la migración reintroduzca una dependencia de los defaults.
const SQL = readFileSync(path.resolve(__dirname, "../supabase/migrations/20261010090000_modify_order.sql"), "utf-8");
const code = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

const DEFINERS = ["create_order", "create_quick_retail_sale", "modify_order", "modify_order_stock_effect"];
const INTERNAL = ["create_order_impl", "create_quick_retail_sale_impl", "modify_order_stock_effect"];

function definitionOf(name: string): string {
  const start = code.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  expect(start, `no se encontró ${name}`).toBeGreaterThanOrEqual(0);
  const end = code.indexOf("$$;", code.indexOf("as $$", start));
  return code.slice(start, end + 3);
}

describe("SECURITY DEFINER de modify_order: search_path y EXECUTE explícitos", () => {
  for (const name of DEFINERS) {
    it(`${name}: security definer con search_path fijo 'public, pg_temp'`, () => {
      const def = definitionOf(name);
      expect(def).toMatch(/security definer/);
      expect(def).toMatch(/set search_path = public, pg_temp/);
    });

    it(`${name}: ACL explícita — revoke all desde PUBLIC, anon, authenticated y service_role`, () => {
      expect(code).toMatch(
        new RegExp(`revoke all on function public\\.${name}\\([^;]*\\)\\s+from public, anon, authenticated, service_role;`)
      );
    });
  }

  it("NINGÚN grant a PUBLIC ni a anon en toda la migración", () => {
    const grants = code.match(/grant [^;]*;/gi) ?? [];
    for (const g of grants) {
      expect(g).not.toMatch(/\bto\b[^;]*\b(public|anon)\b/i);
    }
  });

  it("los grants de EXECUTE son exactamente los esperados (wrappers: authenticated + service_role; modify_order: authenticated)", () => {
    const executeGrants = (code.match(/grant execute on function [^;]*;/gi) ?? []).map((g) => g.replace(/\s+/g, " "));
    expect(executeGrants).toHaveLength(3);
    expect(executeGrants.find((g) => g.includes("public.create_order("))).toMatch(/to authenticated, service_role;$/);
    expect(executeGrants.find((g) => g.includes("public.create_quick_retail_sale("))).toMatch(/to authenticated, service_role;$/);
    expect(executeGrants.find((g) => g.includes("public.modify_order("))).toMatch(/to authenticated;$/);
  });

  it("las funciones internas (*_impl, modify_order_stock_effect) no reciben NINGÚN grant de EXECUTE", () => {
    for (const name of INTERNAL) {
      expect(code).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\(`));
    }
    // y los *_impl se revocan explícitamente
    for (const name of ["create_order_impl", "create_quick_retail_sale_impl"]) {
      expect(code).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]*\\)\\s+from public, anon, authenticated, service_role;`));
    }
  });

  it("las funciones definer sólo usan relaciones y funciones propias calificadas por esquema", () => {
    for (const name of DEFINERS) {
      const def = definitionOf(name)
        .replace(/'(?:[^']|'')*'/g, "''") // sin literales de texto
        .replace(/--[^\n]*/g, "");
      const relations = [...def.matchAll(/\b(?:from|join|update|insert\s+into|delete\s+from)\s+([a-z_][a-z0-9_.]*)/gi)].map((m) => m[1]);
      for (const rel of relations) {
        if (["jsonb_array_elements"].includes(rel)) continue;
        expect(rel, `${name}: relación sin calificar '${rel}'`).toMatch(/^(public|auth)\./);
      }
      // funciones propias del esquema public invocadas sin calificar
      expect(def, `${name}: llamada sin calificar a is_operations_or_owner`).not.toMatch(/(?<![.\w])is_operations_or_owner\s*\(/);
      expect(def).not.toMatch(/(?<![.\w])(create_order_impl|create_quick_retail_sale_impl|modify_order_stock_effect)\s*\(/);
    }
  });
});
