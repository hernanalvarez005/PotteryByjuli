import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// payment_method_fee_suggestions (Bloque 3): dos reglas de unicidad
// distintas conviviendo en la misma tabla vía índices únicos parciales
// — `unique(payment_method_id, account_id)` a secas NO alcanza acá,
// porque el Postgres estándar no bloquea filas repetidas cuando
// account_id es NULL.

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

describe.skipIf(!hasCredentials)("payment_method_fee_suggestions (local)", () => {
  let admin: SupabaseClient;
  let cardMethodId: string;
  let account1Id: string;
  let account2Id: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: card } = await admin.from("payment_methods").select("id").eq("code", "card").single();
    cardMethodId = card!.id;
    const { data: accounts } = await admin.from("payment_accounts").select("id").limit(2);
    account1Id = accounts![0].id;
    account2Id = accounts![1].id;
  });

  afterEach(async () => {
    await admin.from("payment_method_fee_suggestions").delete().eq("payment_method_id", cardMethodId);
  });

  it("unicidad genérica: una segunda sugerencia sin cuenta para el mismo método se rechaza", async () => {
    const first = await admin
      .from("payment_method_fee_suggestions")
      .insert({ payment_method_id: cardMethodId, suggested_percentage: 5 });
    expect(first.error).toBeNull();

    const second = await admin
      .from("payment_method_fee_suggestions")
      .insert({ payment_method_id: cardMethodId, suggested_percentage: 6 });
    expect(second.error).not.toBeNull();
    expect(second.error!.message).toContain("payment_method_fee_suggestions_generic_key");
  });

  it("unicidad específica: una segunda sugerencia para el mismo método+cuenta se rechaza, pero conviven la genérica y otra cuenta distinta", async () => {
    const generic = await admin
      .from("payment_method_fee_suggestions")
      .insert({ payment_method_id: cardMethodId, suggested_percentage: 5 });
    expect(generic.error).toBeNull();

    const specific1 = await admin
      .from("payment_method_fee_suggestions")
      .insert({ payment_method_id: cardMethodId, account_id: account1Id, suggested_percentage: 8 });
    expect(specific1.error).toBeNull();

    // Repetir el mismo método+cuenta falla.
    const specific1Again = await admin
      .from("payment_method_fee_suggestions")
      .insert({ payment_method_id: cardMethodId, account_id: account1Id, suggested_percentage: 9 });
    expect(specific1Again.error).not.toBeNull();
    expect(specific1Again.error!.message).toContain("payment_method_fee_suggestions_specific_key");

    // Pero el mismo método con OTRA cuenta convive sin problema.
    const specific2 = await admin
      .from("payment_method_fee_suggestions")
      .insert({ payment_method_id: cardMethodId, account_id: account2Id, suggested_percentage: 3 });
    expect(specific2.error).toBeNull();

    const { data: rows } = await admin
      .from("payment_method_fee_suggestions")
      .select("account_id,suggested_percentage")
      .eq("payment_method_id", cardMethodId);
    expect(rows).toHaveLength(3);
  });

  it("suggested_percentage fuera de 0-100 se rechaza", async () => {
    const tooHigh = await admin
      .from("payment_method_fee_suggestions")
      .insert({ payment_method_id: cardMethodId, suggested_percentage: 150 });
    expect(tooHigh.error).not.toBeNull();

    const negative = await admin
      .from("payment_method_fee_suggestions")
      .insert({ payment_method_id: cardMethodId, suggested_percentage: -1 });
    expect(negative.error).not.toBeNull();

    const boundary = await admin
      .from("payment_method_fee_suggestions")
      .insert({ payment_method_id: cardMethodId, suggested_percentage: 100 });
    expect(boundary.error).toBeNull();
  });
});
