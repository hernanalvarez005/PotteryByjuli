import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// la búsqueda server-side de /clientes (tanda de usabilidad, sección
// 19): mirror exacto de getCustomers (lib/customers.ts) — no invocable
// directamente (usa next/headers).

function loadEnvLocal() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const envPath = path.resolve(__dirname, "..", ".env.development.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isLocal = Boolean(SUPABASE_URL?.includes("127.0.0.1") || SUPABASE_URL?.includes("localhost"));
const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY && isLocal);

function escapePostgrestPattern(raw: string): string {
  return raw.replace(/[%_,()]/g, (c) => `\\${c}`);
}

async function searchCustomers(admin: SupabaseClient, query: string) {
  const pattern = `%${escapePostgrestPattern(query.trim())}%`;
  const { data, error } = await admin
    .from("customers")
    .select("id,first_name,last_name,whatsapp,email,cuit")
    .eq("is_active", true)
    .or(
      `first_name.ilike.${pattern},last_name.ilike.${pattern},whatsapp.ilike.${pattern},email.ilike.${pattern},company_name.ilike.${pattern},cuit.ilike.${pattern}`
    );
  if (error) throw error;
  return data ?? [];
}

describe.skipIf(!hasCredentials)("customer search (local)", () => {
  let admin: SupabaseClient;
  let matchId: string;
  let otherId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: match } = await admin
      .from("customers")
      .insert({ first_name: "Búsqueda", last_name: "Fixture", whatsapp: "+54 9 11 9999-8888", email: "busqueda.fixture@example.com", cuit: "20-99998888-5" })
      .select("id")
      .single();
    matchId = match!.id;
    const { data: other } = await admin.from("customers").insert({ first_name: "NoRelacionado", last_name: "Otro" }).select("id").single();
    otherId = other!.id;
  });

  afterAll(async () => {
    await admin.from("customers").delete().in("id", [matchId, otherId]);
  });

  it("matches by first name (case-insensitive, partial)", async () => {
    const results = await searchCustomers(admin, "búsq");
    expect(results.some((c) => c.id === matchId)).toBe(true);
    expect(results.some((c) => c.id === otherId)).toBe(false);
  });

  it("matches by whatsapp substring", async () => {
    const results = await searchCustomers(admin, "99998888");
    expect(results.some((c) => c.id === matchId)).toBe(true);
  });

  it("matches by email", async () => {
    const results = await searchCustomers(admin, "busqueda.fixture@example.com");
    expect(results.some((c) => c.id === matchId)).toBe(true);
  });

  it("matches by cuit", async () => {
    const results = await searchCustomers(admin, "99998888-5");
    expect(results.some((c) => c.id === matchId)).toBe(true);
  });

  it("a query containing PostgREST-special characters never throws or matches everything", async () => {
    // Antes del escape, una coma o un paréntesis en el texto rompía la
    // sintaxis del filtro `.or()` — esto confirma que ahora es un texto
    // literal más, no sintaxis.
    const results = await searchCustomers(admin, "algo(raro),con%comas_");
    expect(results.some((c) => c.id === matchId)).toBe(false);
    expect(results.some((c) => c.id === otherId)).toBe(false);
  });
});
