import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// orders.sold_at (auditoría "Próxima evolución operativa", bloque 1
// corregido): un trigger BEFORE, separado e independiente de los
// triggers AFTER que alimentan order_status_history, completa sold_at
// exactamente cuando el pedido pasa a delivered — nunca antes, nunca
// pisando un valor ya escrito.

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

describe.skipIf(!hasCredentials)("orders.sold_at trigger (local)", () => {
  let admin: SupabaseClient;
  let customerId: string;
  let businessUnitId: string;
  const orderIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: customer } = await admin.from("customers").insert({ first_name: "SoldAt Fixture" }).select("id").single();
    customerId = customer!.id;
    const { data: unit } = await admin.from("business_units").select("id").eq("code", "retail").single();
    businessUnitId = unit!.id;
  });

  afterAll(async () => {
    await admin.from("orders").delete().in("id", orderIds);
    await admin.from("customers").delete().eq("id", customerId);
  });

  it("fills sold_at automatically when a row is inserted already delivered (quick retail sale)", async () => {
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: businessUnitId, customer_id: customerId, status: "delivered" })
      .select("id,sold_at")
      .single();
    orderIds.push(order!.id);
    expect(order!.sold_at).not.toBeNull();
  });

  it("does NOT fill sold_at while the order is still pending/confirmed — only on the delivered transition", async () => {
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: businessUnitId, customer_id: customerId, status: "pending" })
      .select("id")
      .single();
    const orderId = order!.id;
    orderIds.push(orderId);

    const { data: pending } = await admin.from("orders").select("sold_at").eq("id", orderId).single();
    expect(pending?.sold_at).toBeNull();

    await admin.from("orders").update({ status: "confirmed" }).eq("id", orderId);
    const { data: confirmed } = await admin.from("orders").select("sold_at").eq("id", orderId).single();
    expect(confirmed?.sold_at).toBeNull();

    await admin.from("orders").update({ status: "delivered" }).eq("id", orderId);
    const { data: delivered } = await admin.from("orders").select("sold_at").eq("id", orderId).single();
    expect(delivered?.sold_at).not.toBeNull();
  });

  it("never overwrites a sold_at that was already set", async () => {
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: businessUnitId, customer_id: customerId, status: "delivered" })
      .select("id,sold_at")
      .single();
    const orderId = order!.id;
    orderIds.push(orderId);
    const originalSoldAt = order!.sold_at;

    await new Promise((resolve) => setTimeout(resolve, 20));
    await admin.from("orders").update({ notes: "cualquier otro cambio" }).eq("id", orderId);

    const { data: after } = await admin.from("orders").select("sold_at").eq("id", orderId).single();
    expect(after?.sold_at).toBe(originalSoldAt);
  });
});
