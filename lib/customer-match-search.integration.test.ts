import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Prueba
// la búsqueda de coincidencias antes de crear un cliente (tanda de
// usabilidad, sección 2) — mirror exacto de findCustomerMatches
// (app/(app)/clientes/actions.ts), que depende de next/headers y no se
// puede invocar directamente fuera de un request de Next.

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

function phoneSuffix(raw: string, n = 8): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < n) return null;
  return digits.slice(-n);
}

async function findMatches(
  admin: SupabaseClient,
  input: { first_name?: string; last_name?: string; whatsapp?: string; email?: string }
) {
  const matches = new Map<string, { id: string; matchedBy: string[] }>();
  function addMatch(id: string, signal: string) {
    const existing = matches.get(id);
    if (existing) {
      if (!existing.matchedBy.includes(signal)) existing.matchedBy.push(signal);
    } else {
      matches.set(id, { id, matchedBy: [signal] });
    }
  }

  const suffix = input.whatsapp ? phoneSuffix(input.whatsapp) : null;
  if (suffix) {
    const { data } = await admin.from("customers").select("id,whatsapp").eq("is_active", true).not("whatsapp", "is", null);
    for (const row of data ?? []) {
      if (row.whatsapp && row.whatsapp.replace(/\D/g, "").endsWith(suffix)) addMatch(row.id, "whatsapp");
    }
  }
  if (input.email) {
    const { data } = await admin.from("customers").select("id").eq("is_active", true).ilike("email", input.email);
    for (const row of data ?? []) addMatch(row.id, "email");
  }
  if (input.first_name && input.last_name) {
    const { data } = await admin
      .from("customers")
      .select("id")
      .eq("is_active", true)
      .ilike("first_name", input.first_name)
      .ilike("last_name", input.last_name);
    for (const row of data ?? []) addMatch(row.id, "name");
  }
  return [...matches.values()];
}

describe.skipIf(!hasCredentials)("findCustomerMatches (local)", () => {
  let admin: SupabaseClient;
  let existingId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data } = await admin
      .from("customers")
      .insert({ first_name: "Juan", last_name: "Pérez Fixture", whatsapp: "+54 9 11 5555-4444", email: "juan.perez.fixture@example.com" })
      .select("id")
      .single();
    existingId = data!.id;
  });

  afterAll(async () => {
    await admin.from("customers").delete().eq("id", existingId);
  });

  it("matches by whatsapp even with completely different formatting/prefix", async () => {
    const matches = await findMatches(admin, { whatsapp: "01155554444" });
    expect(matches.some((m) => m.id === existingId && m.matchedBy.includes("whatsapp"))).toBe(true);
  });

  it("matches by email case-insensitively", async () => {
    const matches = await findMatches(admin, { email: "JUAN.PEREZ.FIXTURE@example.com" });
    expect(matches.some((m) => m.id === existingId && m.matchedBy.includes("email"))).toBe(true);
  });

  it("matches by name as a weak signal", async () => {
    const matches = await findMatches(admin, { first_name: "Juan", last_name: "Pérez Fixture" });
    expect(matches.some((m) => m.id === existingId && m.matchedBy.includes("name"))).toBe(true);
  });

  it("finds nothing for an unrelated search", async () => {
    const matches = await findMatches(admin, { whatsapp: "99999999", email: "nadie@nowhere.test", first_name: "Zzz", last_name: "Nadie" });
    expect(matches.some((m) => m.id === existingId)).toBe(false);
  });

  it("a short/partial phone number never triggers a match (avoids absurdly loose suffixes)", async () => {
    const matches = await findMatches(admin, { whatsapp: "4444" });
    expect(matches.some((m) => m.id === existingId)).toBe(false);
  });
});
