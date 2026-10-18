import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Guardia estática de la migración "extended_order_delete" (20261018100000): ACL explícita,
// search_path fijo y las reglas que NO pueden aflojarse por una edición futura. El comportamiento
// real lo prueban los tests de integración (app/(app)/pedidos/extended-delete.integration.test.ts).
const SQL = readFileSync(path.resolve(__dirname, "../supabase/migrations/20261018100000_extended_order_delete.sql"), "utf-8");
const code = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

function definitionOf(name: string): string {
  const start = code.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  expect(start, `no se encontró ${name}`).toBeGreaterThanOrEqual(0);
  const end = code.indexOf("$$;", code.indexOf("as $$", start));
  return code.slice(start, end + 3);
}

describe("migración de eliminación segura ampliada", () => {
  it("las dos funciones fijan search_path 'public, pg_temp'", () => {
    for (const name of ["classify_order_for_delete", "delete_order_safe"]) {
      expect(definitionOf(name), name).toMatch(/set search_path = public, pg_temp/);
    }
  });

  it("delete_order_safe es SECURITY DEFINER; classify es invoker y STABLE (sólo lectura)", () => {
    expect(definitionOf("delete_order_safe")).toMatch(/security definer/);
    const classify = definitionOf("classify_order_for_delete");
    expect(classify).not.toMatch(/security definer/);
    expect(classify).toMatch(/\bstable\b/);
  });

  it("ACL explícita: revoke all desde PUBLIC/anon/authenticated/service_role y EXECUTE sólo a authenticated", () => {
    expect(code).toMatch(/revoke all on function public\.classify_order_for_delete\(uuid\)\s+from public, anon, authenticated, service_role;/);
    expect(code).toMatch(/revoke all on function public\.delete_order_safe\(uuid, text, text, boolean\)\s+from public, anon, authenticated, service_role;/);
    const grants = (code.match(/grant execute on function [^;]*;/gi) ?? []).map((g) => g.replace(/\s+/g, " "));
    expect(grants).toHaveLength(2);
    for (const g of grants) expect(g).toMatch(/to authenticated;$/);
    for (const g of code.match(/grant [^;]*;/gi) ?? []) expect(g).not.toMatch(/\bto\b[^;]*\b(public|anon)\b/i);
  });

  it("delete_order_safe: sólo owner, y re-verifica la regla con el pedido bloqueado FOR UPDATE", () => {
    const def = definitionOf("delete_order_safe");
    expect(def).toMatch(/if not public\.is_owner\(\)/);
    expect(def).toMatch(/from public\.orders o where o\.id = p_id for update/);
    expect(def).toMatch(/classify_order_for_delete\(p_id\)/);
  });

  it("exige motivo, confirmación y código tipeado EN LA BASE para los niveles con consecuencias", () => {
    const def = definitionOf("delete_order_safe");
    expect(def).toMatch(/requires_reason and v_reason is null/);
    expect(def).toMatch(/not coalesce\(p_confirmed, false\)/);
    expect(def).toMatch(/upper\(btrim\(coalesce\(p_confirm_code, ''\)\)\) <> upper\(v_order\.human_code\)/);
  });

  it("venta rápida: repone con un `return` compensatorio y NUNCA borra movimientos de stock", () => {
    const def = definitionOf("delete_order_safe");
    expect(def).toMatch(/'return'/);
    expect(def).toMatch(/pg_advisory_xact_lock/);
    expect(def).not.toMatch(/delete from public\.inventory_movements/);
  });

  it("los pagos de un pedido común siguen bloqueando en cualquier nivel (sólo la venta rápida los borra)", () => {
    const def = definitionOf("classify_order_for_delete");
    expect(def).toMatch(/elsif v_payments > 0 or v_movements > 0 or v_production > v_untouched then/);
  });

  it("'producción sin tocar' = pending/cancelled con 0 producidas y 0 rechazadas", () => {
    const def = definitionOf("classify_order_for_delete");
    expect(def).toMatch(/po\.status in \('pending', 'cancelled'\)/);
    expect(def).toMatch(/produced_quantity, 0\) = 0/);
    expect(def).toMatch(/rejected_quantity, 0\) = 0/);
  });

  it("la auditoría guarda nivel, declaración y snapshot completo (ítems, pagos, movimientos, producción)", () => {
    expect(code).toMatch(/add column deletion_level text not null default 'simple'/);
    expect(code).toMatch(/add column declared_test boolean not null default false/);
    expect(code).toMatch(/add column details jsonb/);
    const def = definitionOf("delete_order_safe");
    for (const key of ["'items'", "'payments'", "'movements'", "'production_orders'", "'wholesale_buyer_snapshot'"]) expect(def).toContain(key);
    expect(code).not.toMatch(/on public\.order_deletions\s+for (insert|update|delete|all)/i);
  });
});
