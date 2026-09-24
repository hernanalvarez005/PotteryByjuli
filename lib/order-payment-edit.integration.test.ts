import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre lo
// que updatePayment (app/(app)/pedidos/actions.ts) hace para pagos de
// pedidos/ventas — mismo mecanismo genérico ya probado para cuotas
// (workshop-due-payment-edit.integration.test.ts) y para
// fee_amount/net_amount/auditoría (payments-fee-net.integration.test.ts,
// payment-corrections-audit.integration.test.ts), así que este archivo
// se limita a lo que NINGUNO de esos ya cubre para el caso order_id:
// scoping a order_id, rechazo por rol sin permiso (autenticado, no sólo
// anon), y que el saldo derivado (paidByOrder, lib/orders.ts) refleje el
// monto corregido.

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
const VIEWER_EMAIL = "viewer-test@pottery.local";
const VIEWER_PASSWORD = "test-password-123";

/** Mirrors exactly what updatePayment does: update scoped to both the
 * payment id AND the order it's supposed to belong to. `.select()`
 * makes `data` report which rows actually matched. */
async function updatePaymentScopedToOrder(client: SupabaseClient, paymentId: string, orderId: string, patch: Record<string, unknown>) {
  return client.from("payments").update(patch).eq("id", paymentId).eq("order_id", orderId).select();
}

describe.skipIf(!hasCredentials)("order payment edit (local)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let viewer: SupabaseClient;
  let customerId: string;
  let orderAId: string;
  let orderBId: string;
  let paymentAId: string;
  let cardMethodId: string;
  let cashAccountId: string | null;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    owner = createClient(SUPABASE_URL!, ANON_KEY!);
    viewer = createClient(SUPABASE_URL!, ANON_KEY!);

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
    const { error: ownerSignInErr } = await owner.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    if (ownerSignInErr) throw ownerSignInErr;

    // "Solo lectura" — autenticada, pero sin permiso para corregir pagos.
    // A diferencia de un cliente anónimo (sin sesión, rol Postgres `anon`),
    // acá el rol real es `authenticated`: lo que bloquea la escritura es
    // is_operations_or_owner(), no la ausencia total de policy.
    let viewerId = existing.users.find((u) => u.email === VIEWER_EMAIL)?.id;
    if (!viewerId) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: VIEWER_EMAIL,
        password: VIEWER_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      viewerId = created.user!.id;
      await admin.from("user_roles").insert({ user_id: viewerId, role: "viewer" });
    }
    const { error: viewerSignInErr } = await viewer.auth.signInWithPassword({ email: VIEWER_EMAIL, password: VIEWER_PASSWORD });
    if (viewerSignInErr) throw viewerSignInErr;

    const { data: card } = await admin.from("payment_methods").select("id").eq("code", "card").single();
    cardMethodId = card!.id;
    const { data: account } = await admin.from("payment_accounts").select("id").limit(1).maybeSingle();
    cashAccountId = account?.id ?? null;

    const { data: unit } = await admin.from("business_units").select("id").eq("code", "retail").single();
    const { data: customer } = await admin.from("customers").insert({ first_name: "Order Payment Edit Fixture" }).select("id").single();
    customerId = customer!.id;

    const { data: orderA } = await admin
      .from("orders")
      .insert({ business_unit_id: unit!.id, customer_id: customerId, status: "delivered", total: 10000 })
      .select("id")
      .single();
    orderAId = orderA!.id;
    const { data: orderB } = await admin
      .from("orders")
      .insert({ business_unit_id: unit!.id, customer_id: customerId, status: "delivered", total: 5000 })
      .select("id")
      .single();
    orderBId = orderB!.id;

    const { data: paymentA } = await admin
      .from("payments")
      .insert({ order_id: orderAId, amount: 4000, paid_at: "2026-09-05T12:00:00-03:00" })
      .select("id")
      .single();
    paymentAId = paymentA!.id;
  });

  afterAll(async () => {
    await admin.from("payment_corrections").delete().eq("payment_id", paymentAId);
    await admin.from("payments").delete().in("order_id", [orderAId, orderBId]);
    await admin.from("orders").delete().in("id", [orderAId, orderBId]);
    await admin.from("customers").delete().eq("id", customerId);
  });

  it("updates a payment when the orderId matches its real order_id", async () => {
    const { error, data } = await updatePaymentScopedToOrder(owner, paymentAId, orderAId, { amount: 4500 });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const { data: payment } = await admin.from("payments").select("amount").eq("id", paymentAId).single();
    expect(payment?.amount).toBe(4500);
  });

  it("matches zero rows when orderId doesn't match — never touches a payment via another order's edit form", async () => {
    const { error, data } = await updatePaymentScopedToOrder(owner, paymentAId, orderBId, { amount: 999999 });
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { data: unchanged } = await admin.from("payments").select("amount").eq("id", paymentAId).single();
    expect(unchanged?.amount).not.toBe(999999);
  });

  it("a viewer (authenticated, no owner/operations role) cannot edit a payment — RLS matches zero rows, nothing changes", async () => {
    const { data: before } = await admin.from("payments").select("amount").eq("id", paymentAId).single();

    const { error, data } = await updatePaymentScopedToOrder(viewer, paymentAId, orderAId, { amount: 1 });
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { data: after } = await admin.from("payments").select("amount").eq("id", paymentAId).single();
    expect(after?.amount).toBe(before?.amount);
  });

  it("editing amount/paid_at/method/account/fee_amount together: one update, no new row, original id/order_id preserved, net_amount recalculated", async () => {
    const { count: countBefore } = await admin
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderAId);

    const { error } = await updatePaymentScopedToOrder(owner, paymentAId, orderAId, {
      amount: 6000,
      paid_at: "2026-09-20T15:00:00-03:00",
      method_id: cardMethodId,
      account_id: cashAccountId,
      fee_amount: 348,
      reference: "corregido por Juli",
    });
    expect(error).toBeNull();

    const { count: countAfter } = await admin
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderAId);
    expect(countAfter).toBe(countBefore); // nunca se crea un payment nuevo

    const { data: payment } = await admin
      .from("payments")
      .select("id,order_id,amount,method_id,account_id,fee_amount,net_amount,reference")
      .eq("id", paymentAId)
      .single();
    expect(payment?.id).toBe(paymentAId); // el pago original nunca se pierde
    expect(payment?.order_id).toBe(orderAId);
    expect(payment?.amount).toBe(6000);
    expect(payment?.method_id).toBe(cardMethodId);
    expect(payment?.account_id).toBe(cashAccountId);
    expect(payment?.fee_amount).toBe(348);
    expect(payment?.net_amount).toBe(5652); // 6000 - 348, columna generada
    expect(payment?.reference).toBe("corregido por Juli");
  });

  it("the corrected amount is what a saldo computation (paidByOrder, lib/orders.ts) picks up on the next read", async () => {
    // Segundo pago sobre el mismo pedido, para probar que la corrección
    // de UNO no afecta al otro — paidByOrder suma por order_id, nunca
    // por payment individual.
    const { data: paymentExtra } = await admin
      .from("payments")
      .insert({ order_id: orderAId, amount: 1000, paid_at: "2026-09-06T12:00:00-03:00" })
      .select("id")
      .single();

    await updatePaymentScopedToOrder(owner, paymentAId, orderAId, { amount: 7000 });

    const { data: allPayments } = await admin.from("payments").select("amount").eq("order_id", orderAId);
    const paidByOrder = (allPayments ?? []).reduce((sum, p) => sum + p.amount, 0);
    expect(paidByOrder).toBe(8000); // 7000 corregido + 1000 del segundo pago

    const { data: order } = await admin.from("orders").select("total").eq("id", orderAId).single();
    const balance = order!.total - paidByOrder;
    expect(balance).toBe(2000); // 10000 - 8000

    await admin.from("payments").delete().eq("id", paymentExtra!.id);
  });
});
