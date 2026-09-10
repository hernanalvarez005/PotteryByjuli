import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Prueba
// exactamente lo que hace updateDuePayment (app/(app)/talleres/[groupId]/actions.ts):
// a diferencia de workshop_due_items (append-only a propósito), `payments`
// sí admite update directo — la única garantía nueva a probar acá es que
// el update queda escopeado a `workshop_due_id`, así un paymentId real
// pero de OTRA cuota nunca se toca aunque alguien lo mande igual.

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

const OWNER_EMAIL = "owner-test@pottery.local";
const OWNER_PASSWORD = "test-password-123";

/** Mirrors exactly what updateDuePayment does: update scoped to both the
 * payment id AND the due id it's supposed to belong to. `.select()` makes
 * `data` report which rows actually matched — a plain `.update()` without
 * it returns `data: null` even on a genuine no-op, so it can't
 * distinguish "matched and updated" from "matched nothing". */
async function updatePaymentScopedToDue(client: SupabaseClient, paymentId: string, dueId: string, patch: Record<string, unknown>) {
  return client.from("payments").update(patch).eq("id", paymentId).eq("workshop_due_id", dueId).select();
}

describe.skipIf(!hasCredentials)("updateDuePayment stays scoped to its own due (local)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let programId: string;
  let groupId: string;
  let customerId: string;
  let dueAId: string;
  let dueBId: string;
  let paymentAId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    owner = createClient(SUPABASE_URL!, ANON_KEY!);

    const { data: existing } = await admin.auth.admin.listUsers();
    let ownerId = existing.users.find((u) => u.email === OWNER_EMAIL)?.id;
    if (!ownerId) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      ownerId = created.user!.id;
      await admin.from("user_roles").insert({ user_id: ownerId, role: "owner" });
    }
    const { error: signInErr } = await owner.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    if (signInErr) throw signInErr;

    const { data: program } = await admin.from("workshop_programs").insert({ name: "Fixture payment edit" }).select("id").single();
    programId = program!.id;
    const { data: group } = await admin.from("workshop_groups").insert({ program_id: programId, name: "Grupo fixture", capacity: 5 }).select("id").single();
    groupId = group!.id;
    const { data: customer } = await admin.from("customers").insert({ first_name: "Payment Edit Fixture" }).select("id").single();
    customerId = customer!.id;
    const { data: enrollment } = await admin.from("workshop_enrollments").insert({ group_id: groupId, customer_id: customerId, status: "active" }).select("id").single();

    const { data: dueA } = await admin.from("workshop_dues").insert({ enrollment_id: enrollment!.id, period: "2026-09", amount: 10000 }).select("id").single();
    dueAId = dueA!.id;
    const { data: dueB } = await admin.from("workshop_dues").insert({ enrollment_id: enrollment!.id, period: "2026-10", amount: 20000 }).select("id").single();
    dueBId = dueB!.id;

    const { data: paymentA } = await admin.from("payments").insert({ workshop_due_id: dueAId, amount: 10000, paid_at: "2026-09-05T12:00:00-03:00" }).select("id").single();
    paymentAId = paymentA!.id;
  });

  afterAll(async () => {
    await admin.from("payments").delete().in("workshop_due_id", [dueAId, dueBId]);
    await admin.from("workshop_dues").delete().in("id", [dueAId, dueBId]);
    await admin.from("workshop_enrollments").delete().eq("group_id", groupId);
    await admin.from("customers").delete().eq("id", customerId);
    await admin.from("workshop_groups").delete().eq("id", groupId);
    await admin.from("workshop_programs").delete().eq("id", programId);
  });

  it("updates a payment when the dueId matches its real workshop_due_id", async () => {
    const { error } = await updatePaymentScopedToDue(owner, paymentAId, dueAId, { amount: 7500, reference: "corregido" });
    expect(error).toBeNull();

    const { data } = await admin.from("payments").select("amount,reference").eq("id", paymentAId).single();
    expect(data?.amount).toBe(7500);
    expect(data?.reference).toBe("corregido");
  });

  it("matches zero rows when dueId doesn't match — never touches a payment via the wrong due's edit dialog", async () => {
    const { error, data } = await updatePaymentScopedToDue(owner, paymentAId, dueBId, { amount: 999999 });
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { data: unchanged } = await admin.from("payments").select("amount").eq("id", paymentAId).single();
    expect(unchanged?.amount).not.toBe(999999);
  });

  // Sin sesión, el rol real en Postgres es `anon`, no "authenticated pero
  // sin permiso" — payments no tiene ninguna policy de select/write para
  // `anon` (sólo la owner-only "for all to authenticated" desde Fase 3),
  // así que RLS filtra la fila objetivo a cero matches en vez de tirar un
  // error — mismo comportamiento ya confirmado para workshop_due_items
  // más temprano en esta sesión.
  it("RLS matches zero rows for a truly unauthenticated client — never updates a payment it has no policy to see", async () => {
    const anon = createClient(SUPABASE_URL!, ANON_KEY!);
    const { error, data } = await updatePaymentScopedToDue(anon, paymentAId, dueAId, { amount: 1 });
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { data: unchanged } = await admin.from("payments").select("amount").eq("id", paymentAId).single();
    expect(unchanged?.amount).not.toBe(1);
  });
});
