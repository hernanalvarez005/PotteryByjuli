import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// los cupos de grupo editables (tanda de usabilidad, sección 18): la
// capacidad no puede bajar de las alumnas activas inscriptas — bloqueado
// por un trigger de la DB (defensa de fondo, más allá del chequeo
// amigable del Server Action).

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

describe.skipIf(!hasCredentials)("workshop_groups capacity guard (local)", () => {
  let admin: SupabaseClient;
  let programId: string;
  let groupId: string;
  const customerIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: program } = await admin.from("workshop_programs").insert({ name: "Capacity guard fixture" }).select("id").single();
    programId = program!.id;
    const { data: group } = await admin
      .from("workshop_groups")
      .insert({ program_id: programId, name: "Grupo capacity", capacity: 8 })
      .select("id")
      .single();
    groupId = group!.id;

    for (let i = 0; i < 2; i++) {
      const { data: customer } = await admin.from("customers").insert({ first_name: `Cap${i}` }).select("id").single();
      customerIds.push(customer!.id);
      await admin.from("workshop_enrollments").insert({ group_id: groupId, customer_id: customer!.id, status: "active" });
    }
  });

  afterAll(async () => {
    await admin.from("workshop_enrollments").delete().eq("group_id", groupId);
    await admin.from("customers").delete().in("id", customerIds);
    await admin.from("workshop_groups").delete().eq("id", groupId);
    await admin.from("workshop_programs").delete().eq("id", programId);
  });

  it("allows reducing capacity down to exactly the active enrollment count", async () => {
    const { error } = await admin.from("workshop_groups").update({ capacity: 2 }).eq("id", groupId);
    expect(error).toBeNull();
    const { data } = await admin.from("workshop_groups").select("capacity").eq("id", groupId).single();
    expect(data?.capacity).toBe(2);
  });

  it("blocks reducing capacity below the active enrollment count, naming the real count", async () => {
    const { error } = await admin.from("workshop_groups").update({ capacity: 1 }).eq("id", groupId);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("2");
    // La capacidad no cambió.
    const { data } = await admin.from("workshop_groups").select("capacity").eq("id", groupId).single();
    expect(data?.capacity).toBe(2);
  });

  it("always allows increasing capacity", async () => {
    const { error } = await admin.from("workshop_groups").update({ capacity: 50 }).eq("id", groupId);
    expect(error).toBeNull();
    const { data } = await admin.from("workshop_groups").select("capacity").eq("id", groupId).single();
    expect(data?.capacity).toBe(50);
  });
});
