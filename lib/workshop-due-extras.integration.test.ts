import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Prueba
// que workshop_due_items es realmente append-only a nivel de RLS — ni
// siquiera la owner puede hacer un update/delete directo, sólo insertar
// y anular vía void_due_item (security definer) — y que anular nunca
// borra la fila.

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

describe.skipIf(!hasCredentials)("workshop_due_items is append-only; void_due_item never hard-deletes (local)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let conceptId: string;
  let dueId: string;
  let customerId: string;
  let enrollmentId: string;
  let groupId: string;
  let programId: string;

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

    const { data: concept, error: conceptErr } = await admin
      .from("workshop_due_concepts")
      .insert({ code: `extras-test-${Date.now()}`, name: "Extra de test" })
      .select("id")
      .single();
    if (conceptErr) throw conceptErr;
    conceptId = concept.id;

    const { data: program, error: programErr } = await admin
      .from("workshop_programs")
      .insert({ name: "Programa extras test" })
      .select("id")
      .single();
    if (programErr) throw programErr;
    programId = program.id;

    const { data: group, error: groupErr } = await admin
      .from("workshop_groups")
      .insert({ program_id: programId, name: "Grupo extras test", capacity: 10, monthly_fee: 50000 })
      .select("id")
      .single();
    if (groupErr) throw groupErr;
    groupId = group.id;

    const { data: customer, error: customerErr } = await admin
      .from("customers")
      .insert({ first_name: "Extras Test" })
      .select("id")
      .single();
    if (customerErr) throw customerErr;
    customerId = customer.id;

    const { data: enrollment, error: enrollErr } = await admin
      .from("workshop_enrollments")
      .insert({ group_id: groupId, customer_id: customerId, status: "active" })
      .select("id")
      .single();
    if (enrollErr) throw enrollErr;
    enrollmentId = enrollment.id;

    const { data: due, error: dueErr } = await admin
      .from("workshop_dues")
      .insert({ enrollment_id: enrollmentId, period: "2026-09", amount: 50000 })
      .select("id")
      .single();
    if (dueErr) throw dueErr;
    dueId = due.id;
  });

  afterAll(async () => {
    await admin.from("workshop_due_items").delete().eq("due_id", dueId);
    await admin.from("workshop_dues").delete().eq("id", dueId);
    await admin.from("workshop_enrollments").delete().eq("id", enrollmentId);
    await admin.from("customers").delete().eq("id", customerId);
    await admin.from("workshop_groups").delete().eq("id", groupId);
    await admin.from("workshop_programs").delete().eq("id", programId);
    await admin.from("workshop_due_concepts").delete().eq("id", conceptId);
  });

  it("an owner-authenticated client can insert a due item", async () => {
    const { data, error } = await owner
      .from("workshop_due_items")
      .insert({ due_id: dueId, concept_id: conceptId, amount: 8500, note: "Arcilla 12kg" })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it("an unauthenticated (anon) client cannot insert a due item", async () => {
    const anon = createClient(SUPABASE_URL!, ANON_KEY!);
    const { error } = await anon
      .from("workshop_due_items")
      .insert({ due_id: dueId, concept_id: conceptId, amount: 1000 });
    expect(error).not.toBeNull();
  });

  it("RLS blocks a direct update on workshop_due_items — even for the owner, even trying to change only voided_at", async () => {
    const { data: item } = await admin
      .from("workshop_due_items")
      .select("id")
      .eq("due_id", dueId)
      .is("voided_at", null)
      .limit(1)
      .single();

    const { error, data } = await owner
      .from("workshop_due_items")
      .update({ voided_at: new Date().toISOString() })
      .eq("id", item!.id)
      .select();
    // No UPDATE policy exists at all for this table — RLS silently
    // matches zero rows rather than erroring, so the real assertion is
    // that nothing actually changed (never that .update() itself errors).
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { data: unchanged } = await admin.from("workshop_due_items").select("voided_at").eq("id", item!.id).single();
    expect(unchanged?.voided_at).toBeNull();
  });

  it("RLS blocks a direct delete on workshop_due_items — even for the owner", async () => {
    const { data: item } = await admin
      .from("workshop_due_items")
      .select("id")
      .eq("due_id", dueId)
      .limit(1)
      .single();

    await owner.from("workshop_due_items").delete().eq("id", item!.id);

    const { data: stillThere } = await admin.from("workshop_due_items").select("id").eq("id", item!.id);
    expect(stillThere).toHaveLength(1);
  });

  it("void_due_item sets voided_at/voided_by without deleting the row", async () => {
    const { data: item } = await admin
      .from("workshop_due_items")
      .select("id")
      .eq("due_id", dueId)
      .is("voided_at", null)
      .limit(1)
      .single();

    const { error } = await owner.rpc("void_due_item", { p_id: item!.id });
    expect(error).toBeNull();

    const { data: voided } = await admin
      .from("workshop_due_items")
      .select("id,voided_at,voided_by")
      .eq("id", item!.id)
      .single();
    expect(voided?.voided_at).not.toBeNull();
    expect(voided?.voided_by).toBeTruthy();
  });

  it("calling void_due_item again on an already-voided item is a safe no-op, not an error", async () => {
    const { data: item } = await admin
      .from("workshop_due_items")
      .select("id,voided_at")
      .eq("due_id", dueId)
      .not("voided_at", "is", null)
      .limit(1)
      .single();

    const { error } = await owner.rpc("void_due_item", { p_id: item!.id });
    expect(error).toBeNull();

    const { data: stillVoided } = await admin
      .from("workshop_due_items")
      .select("voided_at")
      .eq("id", item!.id)
      .single();
    expect(stillVoided?.voided_at).toBe(item!.voided_at); // unchanged, not re-stamped
  });

  it("a non-owner/operations client cannot void a due item via the RPC", async () => {
    const anon = createClient(SUPABASE_URL!, ANON_KEY!);
    const { data: item } = await admin
      .from("workshop_due_items")
      .insert({ due_id: dueId, concept_id: conceptId, amount: 500 })
      .select("id")
      .single();

    const { error } = await anon.rpc("void_due_item", { p_id: item!.id });
    expect(error).not.toBeNull();

    const { data: unaffected } = await admin.from("workshop_due_items").select("voided_at").eq("id", item!.id).single();
    expect(unaffected?.voided_at).toBeNull();
  });
});
