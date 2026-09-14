import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// payments.fee_amount/net_amount (Bloque 3 — "Ventas: fecha real, canal,
// comisiones y talleres"): el precio que paga la clienta (price_condition)
// y el costo de procesar el cobro (fee del método/cuenta) son cosas
// distintas — el fee vive únicamente en `payments`, nunca en `orders` ni
// en `price_conditions`. net_amount siempre se deriva (columna
// generada), nunca se acepta como un valor independiente.

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

describe.skipIf(!hasCredentials)("payments.fee_amount / net_amount (local)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let ownerId: string;
  let cashMethodId: string;
  let cardMethodId: string;
  let customerId: string;
  let orderId: string;

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

    const { data: cash } = await admin.from("payment_methods").select("id").eq("code", "cash").single();
    cashMethodId = cash!.id;
    const { data: card } = await admin.from("payment_methods").select("id").eq("code", "card").single();
    cardMethodId = card!.id;

    const { data: unit } = await admin.from("business_units").select("id").eq("code", "retail").single();
    const { data: customer } = await admin.from("customers").insert({ first_name: "Fee Net Fixture" }).select("id").single();
    customerId = customer!.id;
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: unit!.id, customer_id: customerId, status: "delivered", total: 20000 })
      .select("id")
      .single();
    orderId = order!.id;
  });

  afterAll(async () => {
    await admin.from("payments").delete().eq("order_id", orderId);
    await admin.from("orders").delete().eq("id", orderId);
    await admin.from("customers").delete().eq("id", customerId);
  });

  it("efectivo: un pago sin fee_amount explícito queda en 0 y el neto es igual al monto", async () => {
    const { data: payment, error } = await admin
      .from("payments")
      .insert({ order_id: orderId, amount: 4000, method_id: cashMethodId, paid_at: new Date().toISOString() })
      .select("amount,fee_amount,net_amount")
      .single();
    expect(error).toBeNull();
    expect(payment?.fee_amount).toBe(0);
    expect(payment?.net_amount).toBe(4000);
  });

  it("tarjeta con fee: neto = amount - fee, calculado por la base, nunca por el cliente", async () => {
    const { data: payment, error } = await admin
      .from("payments")
      .insert({ order_id: orderId, amount: 6000, fee_amount: 348, method_id: cardMethodId, paid_at: new Date().toISOString() })
      .select("amount,fee_amount,net_amount")
      .single();
    expect(error).toBeNull();
    expect(payment?.net_amount).toBe(5652);
  });

  it("pagos parciales mixtos: efectivo (fee 0) + tarjeta (con fee) en el mismo pedido, cada neto se calcula por separado", async () => {
    const { data: cashPayment } = await admin
      .from("payments")
      .insert({ order_id: orderId, amount: 8000, method_id: cashMethodId, paid_at: new Date().toISOString() })
      .select("id,amount,fee_amount,net_amount")
      .single();
    const { data: cardPayment } = await admin
      .from("payments")
      .insert({ order_id: orderId, amount: 12000, fee_amount: 720, method_id: cardMethodId, paid_at: new Date().toISOString() })
      .select("id,amount,fee_amount,net_amount")
      .single();

    expect(cashPayment?.fee_amount).toBe(0);
    expect(cashPayment?.net_amount).toBe(8000);
    expect(cardPayment?.fee_amount).toBe(720);
    expect(cardPayment?.net_amount).toBe(11280);

    const { data: mixedPayments } = await admin
      .from("payments")
      .select("amount,net_amount")
      .in("id", [cashPayment!.id, cardPayment!.id]);
    const collectedTotal = mixedPayments!.reduce((sum, p) => sum + p.amount, 0);
    const netTotal = mixedPayments!.reduce((sum, p) => sum + p.net_amount, 0);
    expect(collectedTotal).toBe(20000);
    expect(netTotal).toBe(19280); // 20000 - 720 de comisión, la parte en efectivo no resta nada

    await admin.from("payments").delete().in("id", [cashPayment!.id, cardPayment!.id]);
  });

  it("no se puede forzar un neto arbitrario: net_amount es una columna generada, cualquier intento de escribirla directamente falla", async () => {
    const { error } = await admin
      .from("payments")
      .insert({
        order_id: orderId,
        amount: 5000,
        fee_amount: 200,
        // El cliente Supabase no está tipado contra el esquema real
        // (ver lib/supabase/client.ts), así que esto compila igual —
        // la garantía real es que Postgres lo rechace en runtime por
        // ser una columna generada, que es justo lo que este test
        // confirma.
        net_amount: 999999,
        method_id: cardMethodId,
        paid_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toContain("net_amount");
  });

  it("una comisión mayor al monto del pago se rechaza — el neto nunca puede quedar negativo", async () => {
    const { error } = await admin
      .from("payments")
      .insert({ order_id: orderId, amount: 1000, fee_amount: 1500, method_id: cardMethodId, paid_at: new Date().toISOString() })
      .select("id")
      .single();
    expect(error).not.toBeNull();
  });

  it("editar fee_amount queda auditado en payment_corrections, igual que amount/method_id/etc.", async () => {
    const { data: payment } = await admin
      .from("payments")
      .insert({ order_id: orderId, amount: 9000, fee_amount: 100, method_id: cardMethodId, paid_at: new Date().toISOString() })
      .select("id")
      .single();
    const paymentId = payment!.id;

    const { error } = await owner.from("payments").update({ fee_amount: 250 }).eq("id", paymentId);
    expect(error).toBeNull();

    const { data: corrections } = await admin
      .from("payment_corrections")
      .select("changed_by,previous_values,new_values")
      .eq("payment_id", paymentId);
    expect(corrections).toHaveLength(1);
    expect(corrections![0].changed_by).toBe(ownerId);
    expect(corrections![0].previous_values.fee_amount).toBe(100);
    expect(corrections![0].new_values.fee_amount).toBe(250);

    const { data: updated } = await admin.from("payments").select("fee_amount,net_amount").eq("id", paymentId).single();
    expect(updated?.fee_amount).toBe(250);
    expect(updated?.net_amount).toBe(8750);

    await admin.from("payment_corrections").delete().eq("payment_id", paymentId);
    await admin.from("payments").delete().eq("id", paymentId);
  });
});
