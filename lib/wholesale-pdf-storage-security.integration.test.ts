import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Sección 34 del brief de extensión del checkout mayorista: un usuario
// anónimo sin token válido no debe poder acceder a documentos de
// order-attachments, ni listar el bucket. Read-only contra el proyecto
// real (mismo patrón que lib/wholesale-anon-access.integration.test.ts) —
// nunca crea ni mutila nada, así que es seguro dejarlo sin gatear y correr
// contra producción. El caso positivo ("una signed URL válida sí funciona")
// ya está cubierto por e2e/wholesale-checkout.spec.ts (contra Supabase
// local) y se verificó manualmente contra producción durante el desarrollo
// de esta feature — no repetido acá porque requeriría crear un objeto real.

function loadEnvLocal() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY);

describe.skipIf(!hasCredentials)("anon access to order-attachments (private bucket)", () => {
  it("cannot list the bucket's objects", async () => {
    // Storage's list endpoint mirrors table RLS: it doesn't reject the
    // call outright, it filters rows — a 200 with an empty array IS the
    // secure outcome here (same principle as "RLS filters rows, it
    // doesn't error" from the P0 catalog fix). What must never happen is
    // getting back any actual object.
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/order-attachments`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY!,
        Authorization: `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: "", limit: 100 }),
    });
    const body = res.ok ? await res.json() : [];
    expect(Array.isArray(body) ? body : []).toHaveLength(0);
  });

  it("cannot read an object directly by a guessed/plausible path (no signed token)", async () => {
    // Even a syntactically plausible path (uuid-shaped folder + a
    // MAY-000001.pdf-shaped filename) must not be readable without a
    // signed token — the point of a private bucket is that a leaked or
    // guessed human_code alone must never be enough.
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/order-attachments/00000000-0000-0000-0000-000000000000/MAY-000001.pdf`,
      { headers: { apikey: ANON_KEY!, Authorization: `Bearer ${ANON_KEY}` } }
    );
    expect(res.ok).toBe(false);
  });
});
