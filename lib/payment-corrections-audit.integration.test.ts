import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre la
// auditoría de correcciones a pagos (tanda de usabilidad, sección 14):
// editar un pago nunca lo borra/recrea — se actualiza la fila real y un
// trigger deja un registro de qué cambió, quién y cuándo en
// payment_corrections.

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

describe.skipIf(!hasCredentials)("payment_corrections audit trail (local)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let ownerId: string;
  let customerId: string;
  let orderId: string;
  let paymentId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    owner = createClient(SUPABASE_URL!, ANON_KEY!);

    const { data: existing } = await admin.auth.admin.listUsers();
    let existingOwnerId = existing.users.find((u) => u.email === OWNER_EMAIL)?.id;
    if (!existingOwnerId) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      existingOwnerId = created.user!.id;
      await admin.from("user_roles").insert({ user_id: existingOwnerId, role: "owner" });
    }
    ownerId = existingOwnerId;
    const { error: signInErr } = await owner.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    if (signInErr) throw signInErr;

    const { data: unit } = await admin.from("business_units").select("id").eq("code", "retail").single();
    const { data: customer } = await admin.from("customers").insert({ first_name: "Audit Fixture" }).select("id").single();
    customerId = customer!.id;
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: unit!.id, customer_id: customerId, status: "delivered" })
      .select("id")
      .single();
    orderId = order!.id;
    const { data: payment } = await admin
      .from("payments")
      .insert({ order_id: orderId, amount: 1000, paid_at: new Date().toISOString() })
      .select("id")
      .single();
    paymentId = payment!.id;
  });

  afterAll(async () => {
    await admin.from("payment_corrections").delete().eq("payment_id", paymentId);
    await admin.from("payments").delete().eq("id", paymentId);
    await admin.from("orders").delete().eq("id", orderId);
    await admin.from("customers").delete().eq("id", customerId);
  });

  it("never logs anything before the payment is ever edited", async () => {
    const { count } = await admin.from("payment_corrections").select("id", { count: "exact", head: true }).eq("payment_id", paymentId);
    expect(count).toBe(0);
  });

  it("logs previous/new values and the acting user when a real field changes", async () => {
    const { error } = await owner.from("payments").update({ amount: 1500, reference: "corregido" }).eq("id", paymentId);
    expect(error).toBeNull();

    const { data: corrections } = await admin.from("payment_corrections").select("*").eq("payment_id", paymentId).order("changed_at", { ascending: false });
    expect(corrections).toHaveLength(1);
    const correction = corrections![0];
    expect(correction.changed_by).toBe(ownerId);
    expect(correction.previous_values.amount).toBe(1000);
    expect(correction.new_values.amount).toBe(1500);
    expect(correction.previous_values.reference).toBeNull();
    expect(correction.new_values.reference).toBe("corregido");

    // El pago real quedó corregido — nunca se borró/recreó.
    const { data: payment } = await admin.from("payments").select("id,amount,reference").eq("id", paymentId).single();
    expect(payment?.id).toBe(paymentId);
    expect(payment?.amount).toBe(1500);
  });

  it("does not log again when an update changes nothing", async () => {
    await owner.from("payments").update({ amount: 1500 }).eq("id", paymentId);
    const { count } = await admin.from("payment_corrections").select("id", { count: "exact", head: true }).eq("payment_id", paymentId);
    expect(count).toBe(1);
  });

  it("logs a second, independent correction for a second real edit", async () => {
    await owner.from("payments").update({ amount: 2000 }).eq("id", paymentId);
    const { data: corrections } = await admin.from("payment_corrections").select("previous_values,new_values").eq("payment_id", paymentId).order("changed_at", { ascending: true });
    expect(corrections).toHaveLength(2);
    expect(corrections![1].previous_values.amount).toBe(1500);
    expect(corrections![1].new_values.amount).toBe(2000);
  });

  it("never allows created_at to be touched by an edit", async () => {
    const { data: before } = await admin.from("payments").select("created_at").eq("id", paymentId).single();
    await owner.from("payments").update({ amount: 2500 }).eq("id", paymentId);
    const { data: after } = await admin.from("payments").select("created_at").eq("id", paymentId).single();
    expect(after?.created_at).toBe(before?.created_at);
  });
});
