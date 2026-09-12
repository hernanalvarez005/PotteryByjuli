import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// merge_customers (tanda de usabilidad, secciones 20-22): el principal
// sobrevive, el duplicado se archiva (nunca hard delete) con un puntero
// explícito, las FK se migran cuando es seguro (dejando intactas las que
// violarían una restricción de unicidad real), y los conflictos de datos
// (whatsapp/email/cuit/company_name) se resuelven con el valor que la
// usuaria haya elegido — nunca decidido en silencio.

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
const OPS_EMAIL = "operations-test@pottery.local";
const OPS_PASSWORD = "test-password-123";

describe.skipIf(!hasCredentials)("merge_customers (local)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let operations: SupabaseClient;
  let primaryId: string;
  let duplicateId: string;
  let programId: string;
  let groupAId: string;
  let groupBId: string;
  let tag1Id: string;
  let tag2Id: string;
  let orderId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    owner = createClient(SUPABASE_URL!, ANON_KEY!);
    operations = createClient(SUPABASE_URL!, ANON_KEY!);

    async function ensureUser(email: string, role: "owner" | "operations") {
      const { data: existing } = await admin.auth.admin.listUsers();
      let id = existing.users.find((u) => u.email === email)?.id;
      if (!id) {
        const { data: created, error } = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
        if (error) throw error;
        id = created.user!.id;
        await admin.from("user_roles").insert({ user_id: id, role });
      }
      return id;
    }
    await ensureUser(OWNER_EMAIL, "owner");
    await ensureUser(OPS_EMAIL, "operations");
    await owner.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    await operations.auth.signInWithPassword({ email: OPS_EMAIL, password: OPS_PASSWORD });

    const { data: primary } = await admin
      .from("customers")
      .insert({ first_name: "Principal", last_name: "Fixture", whatsapp: "+54 9 11 1111-1111" })
      .select("id")
      .single();
    primaryId = primary!.id;
    const { data: duplicate } = await admin
      .from("customers")
      .insert({ first_name: "Duplicado", last_name: "Fixture", whatsapp: "+54 9 22 2222-2222", email: "dup@example.com", cuit: "20-12345678-9" })
      .select("id")
      .single();
    duplicateId = duplicate!.id;

    const { data: tag1 } = await admin.from("customer_tags").insert({ code: `merge-test-tag1-${Date.now()}`, name: "Tag Uno" }).select("id").single();
    tag1Id = tag1!.id;
    const { data: tag2 } = await admin.from("customer_tags").insert({ code: `merge-test-tag2-${Date.now()}`, name: "Tag Dos" }).select("id").single();
    tag2Id = tag2!.id;
    // Ambos tienen tag1 (conflicto de unicidad al migrar) — sólo el
    // duplicado tiene tag2.
    await admin.from("customer_tag_links").insert([
      { customer_id: primaryId, tag_id: tag1Id },
      { customer_id: duplicateId, tag_id: tag1Id },
      { customer_id: duplicateId, tag_id: tag2Id },
    ]);

    const { data: program } = await admin.from("workshop_programs").insert({ name: "Merge test program" }).select("id").single();
    programId = program!.id;
    const { data: groupA } = await admin.from("workshop_groups").insert({ program_id: programId, name: "Grupo A", capacity: 10 }).select("id").single();
    groupAId = groupA!.id;
    const { data: groupB } = await admin.from("workshop_groups").insert({ program_id: programId, name: "Grupo B", capacity: 10 }).select("id").single();
    groupBId = groupB!.id;
    // Mismo grupo para ambos (conflicto de unicidad al migrar) + un grupo
    // distinto sólo para el duplicado (sin conflicto).
    await admin.from("workshop_enrollments").insert([
      { group_id: groupAId, customer_id: primaryId, status: "active" },
      { group_id: groupAId, customer_id: duplicateId, status: "active" },
      { group_id: groupBId, customer_id: duplicateId, status: "active" },
    ]);

    const { data: unit } = await admin.from("business_units").select("id").eq("code", "retail").single();
    const { data: order } = await admin.from("orders").insert({ business_unit_id: unit!.id, customer_id: duplicateId, status: "pending" }).select("id").single();
    orderId = order!.id;
    await admin.from("customer_notes").insert({ customer_id: duplicateId, note: "Nota del duplicado" });
  });

  afterAll(async () => {
    await admin.from("customer_notes").delete().in("customer_id", [primaryId, duplicateId]);
    await admin.from("orders").delete().eq("id", orderId);
    await admin.from("workshop_enrollments").delete().in("group_id", [groupAId, groupBId]);
    await admin.from("workshop_groups").delete().in("id", [groupAId, groupBId]);
    await admin.from("workshop_programs").delete().eq("id", programId);
    await admin.from("customer_tag_links").delete().in("tag_id", [tag1Id, tag2Id]);
    await admin.from("customer_tags").delete().in("id", [tag1Id, tag2Id]);
    await admin.from("customers").delete().in("id", [primaryId, duplicateId]);
  });

  it("rejects a non-owner (operations)", async () => {
    const { error } = await operations.rpc("merge_customers", { p_primary_id: primaryId, p_duplicate_id: duplicateId });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("administradora");
  });

  it("rejects merging a customer with itself", async () => {
    const { error } = await owner.rpc("merge_customers", { p_primary_id: primaryId, p_duplicate_id: primaryId });
    expect(error).not.toBeNull();
  });

  it("merges: migrates safe FKs, resolves conflicts explicitly, archives the duplicate without deleting it", async () => {
    const { error } = await owner.rpc("merge_customers", {
      p_primary_id: primaryId,
      p_duplicate_id: duplicateId,
      p_email: "dup@example.com",
      p_cuit: "20-12345678-9",
    });
    expect(error).toBeNull();

    // El principal quedó con los valores elegidos (whatsapp propio
    // conservado — nunca pisado porque no se pasó p_whatsapp).
    const { data: primary } = await admin.from("customers").select("whatsapp,email,cuit,is_active,merged_into_customer_id").eq("id", primaryId).single();
    expect(primary?.whatsapp).toBe("+54 9 11 1111-1111");
    expect(primary?.email).toBe("dup@example.com");
    expect(primary?.cuit).toBe("20-12345678-9");
    expect(primary?.is_active).toBe(true);
    expect(primary?.merged_into_customer_id).toBeNull();

    // El duplicado nunca se borró — sigue existiendo, archivado, con el
    // puntero a dónde se fusionó.
    const { data: duplicate } = await admin.from("customers").select("is_active,merged_into_customer_id,merged_at,merged_by").eq("id", duplicateId).single();
    expect(duplicate?.is_active).toBe(false);
    expect(duplicate?.merged_into_customer_id).toBe(primaryId);
    expect(duplicate?.merged_at).toBeTruthy();
    expect(duplicate?.merged_by).toBeTruthy();

    // Orders y notes del duplicado migraron al principal.
    const { data: order } = await admin.from("orders").select("customer_id").eq("id", orderId).single();
    expect(order?.customer_id).toBe(primaryId);
    const { data: note } = await admin.from("customer_notes").select("customer_id").eq("note", "Nota del duplicado").single();
    expect(note?.customer_id).toBe(primaryId);

    // Tags: unión en el principal (tag1 ya estaba, tag2 se sumó), y el
    // duplicado quedó sin links propios.
    const { data: primaryTags } = await admin.from("customer_tag_links").select("tag_id").eq("customer_id", primaryId);
    expect(new Set(primaryTags?.map((t) => t.tag_id))).toEqual(new Set([tag1Id, tag2Id]));
    const { count: dupTagCount } = await admin.from("customer_tag_links").select("customer_id", { count: "exact", head: true }).eq("customer_id", duplicateId);
    expect(dupTagCount).toBe(0);

    // Enrollments: el de Grupo B (sin conflicto) migró; el de Grupo A
    // (mismo grupo que el principal) se dejó como estaba, apuntando al
    // duplicado ya archivado — nunca se perdió esa fila ni su historial.
    const { data: groupAEnrollments } = await admin.from("workshop_enrollments").select("customer_id").eq("group_id", groupAId);
    expect(groupAEnrollments?.map((e) => e.customer_id).sort()).toEqual([duplicateId, primaryId].sort());
    const { data: groupBEnrollments } = await admin.from("workshop_enrollments").select("customer_id").eq("group_id", groupBId);
    expect(groupBEnrollments).toHaveLength(1);
    expect(groupBEnrollments![0].customer_id).toBe(primaryId);
  });

  it("rejects merging a customer that was already merged (as the duplicate again)", async () => {
    const { data: another } = await admin.from("customers").insert({ first_name: "Otro" }).select("id").single();
    const { error } = await owner.rpc("merge_customers", { p_primary_id: another!.id, p_duplicate_id: duplicateId });
    expect(error).not.toBeNull();
    await admin.from("customers").delete().eq("id", another!.id);
  });
});
