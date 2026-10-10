import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Guardia estática de la migración "payment_corrections_reason" (20261010100000):
// la corrección de pagos corre con los permisos de quien llama (SECURITY INVOKER, así la RLS de
// `payments` sigue aplicando), con search_path fijo, EXECUTE sólo para authenticated, y el DELETE
// directo sobre `payments` queda cerrado. El comportamiento real lo prueban los tests de
// integración (lib/payment-correction.integration.test.ts); esto evita que una edición futura de
// la migración reabra el borrado o afloje la ACL sin que nadie lo note.
const SQL = readFileSync(path.resolve(__dirname, "../supabase/migrations/20261010100000_payment_corrections_reason.sql"), "utf-8");
const code = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

function definitionOf(name: string): string {
  const start = code.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  expect(start, `no se encontró ${name}`).toBeGreaterThanOrEqual(0);
  const end = code.indexOf("$$;", code.indexOf("as $$", start));
  return code.slice(start, end + 3);
}

describe("migración de corrección de pagos", () => {
  it("correct_payment: SECURITY INVOKER con search_path fijo 'public, pg_temp' (la RLS de payments sigue aplicando)", () => {
    const def = definitionOf("correct_payment");
    expect(def).toMatch(/security invoker/);
    expect(def).not.toMatch(/security definer/);
    expect(def).toMatch(/set search_path = public, pg_temp/);
  });

  it("correct_payment: ACL explícita — revoke all desde PUBLIC/anon/authenticated/service_role y EXECUTE sólo a authenticated", () => {
    expect(code).toMatch(
      /revoke all on function public\.correct_payment\([^;]*\)\s+from public, anon, authenticated, service_role;/
    );
    const grants = (code.match(/grant execute on function [^;]*;/gi) ?? []).map((g) => g.replace(/\s+/g, " "));
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/public\.correct_payment\(.*\) to authenticated;$/);
    for (const g of code.match(/grant [^;]*;/gi) ?? []) expect(g).not.toMatch(/\bto\b[^;]*\b(public|anon)\b/i);
  });

  it("el trigger de auditoría conserva SECURITY DEFINER + search_path fijo y lee el motivo de la variable de transacción", () => {
    const def = definitionOf("log_payment_correction");
    expect(def).toMatch(/security definer/);
    expect(def).toMatch(/set search_path = public, pg_temp/);
    expect(def).toMatch(/current_setting\('pottery\.payment_correction_reason', true\)/);
  });

  it("la variable del motivo es local a la transacción (set_config … true) y se limpia después del UPDATE", () => {
    const def = definitionOf("correct_payment");
    const sets = def.match(/set_config\('pottery\.payment_correction_reason'[^;]*;/g) ?? [];
    expect(sets).toHaveLength(2);
    for (const s of sets) expect(s).toMatch(/, true\)/);
  });

  it("serializa correcciones simultáneas con FOR UPDATE sobre la fila del pago", () => {
    expect(definitionOf("correct_payment")).toMatch(/from public\.payments p where p\.id = p_payment_id for update/);
  });

  it("cierra el DELETE directo: sin política FOR ALL/DELETE y con REVOKE DELETE a anon y authenticated", () => {
    expect(code).toMatch(/drop policy if exists "payments_write_operations" on public\.payments;/);
    expect(code).not.toMatch(/create policy [^;]*on public\.payments\s+for (all|delete)/i);
    expect(code).toMatch(/create policy "payments_insert_operations" on public\.payments\s+for insert/);
    expect(code).toMatch(/create policy "payments_update_operations" on public\.payments\s+for update/);
    expect(code).toMatch(/revoke delete on public\.payments from anon, authenticated;/);
  });

  it("agrega el motivo (≤300) a payment_corrections sin abrirle escrituras", () => {
    expect(code).toMatch(/alter table public\.payment_corrections\s+add column reason text check \(reason is null or char_length\(reason\) <= 300\)/);
    expect(code).not.toMatch(/on public\.payment_corrections\s+for (insert|update|delete|all)/i);
  });
});
