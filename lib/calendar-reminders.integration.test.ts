import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// calendar_reminders y las dos consultas nuevas de lib/calendar.ts
// (getOrderDeliveriesInRange/getRemindersInRange no son invocables acá —
// usan next/headers) del Bloque 7 ("Próxima evolución operativa").

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

describe.skipIf(!hasCredentials)("calendar_reminders + calendario order deliveries (local)", () => {
  let admin: SupabaseClient;
  let specialDateId: string;
  let reminderId: string;
  const remindAt = "2026-10-10";

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: special } = await admin
      .from("special_dates")
      .insert({ title: "Día de la Madre (test)", date: "2026-10-18" })
      .select("id")
      .single();
    specialDateId = special!.id;

    const { data: reminder } = await admin
      .from("calendar_reminders")
      .insert({ title: "Pedir presupuesto de flores", remind_at: remindAt, special_date_id: specialDateId })
      .select("id")
      .single();
    reminderId = reminder!.id;
  });

  afterAll(async () => {
    await admin.from("calendar_reminders").delete().eq("id", reminderId);
    await admin.from("special_dates").delete().eq("id", specialDateId);
  });

  it("linking a reminder to a special date never duplicates a row in special_dates", async () => {
    const { count } = await admin.from("special_dates").select("id", { count: "exact", head: true }).eq("id", specialDateId);
    expect(count).toBe(1);
  });

  it("mirrors getRemindersInRange: the linked special date's title/date come along, never a copy", async () => {
    const { data } = await admin
      .from("calendar_reminders")
      .select("id,title,remind_at,status,special_date_id,special_dates(title,date)")
      .eq("id", reminderId)
      .single();
    expect(data?.status).toBe("pending");
    const linked = data?.special_dates as unknown as { title: string; date: string } | null;
    expect(linked?.title).toBe("Día de la Madre (test)");
    expect(linked?.date).toBe("2026-10-18");
  });

  it("the check constraint rejects any status outside pending/completed", async () => {
    const { error } = await admin.from("calendar_reminders").insert({ title: "Inválido", remind_at: remindAt, status: "done" });
    expect(error).not.toBeNull();
  });

  it("setReminderStatus mirror: toggling to completed and back never touches the linked special date", async () => {
    await admin.from("calendar_reminders").update({ status: "completed" }).eq("id", reminderId);
    let { data } = await admin.from("calendar_reminders").select("status").eq("id", reminderId).single();
    expect(data?.status).toBe("completed");

    await admin.from("calendar_reminders").update({ status: "pending" }).eq("id", reminderId);
    ({ data } = await admin.from("calendar_reminders").select("status").eq("id", reminderId).single());
    expect(data?.status).toBe("pending");

    const { count } = await admin.from("special_dates").select("id", { count: "exact", head: true }).eq("id", specialDateId);
    expect(count).toBe(1);
  });
});

describe.skipIf(!hasCredentials)("calendario: pedidos con entrega (mirror of getOrderDeliveriesInRange, local)", () => {
  let admin: SupabaseClient;
  let customUnitId: string;
  let customerId: string;
  const createdOrderIds: string[] = [];
  const fromIso = "2026-01-01";
  const toIso = "2026-12-31";

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: unit } = await admin.from("business_units").select("id").eq("code", "custom").single();
    customUnitId = unit!.id;
    const { data: customer } = await admin.from("customers").insert({ first_name: "Calendario Fixture" }).select("id").single();
    customerId = customer!.id;
  });

  afterAll(async () => {
    await admin.from("orders").delete().in("id", createdOrderIds);
    await admin.from("customers").delete().eq("id", customerId);
  });

  async function makeOrder(status: string, estimatedDate: string | null) {
    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: customUnitId, customer_id: customerId, status, estimated_date: estimatedDate })
      .select("id")
      .single();
    createdOrderIds.push(order!.id);
    return order!.id;
  }

  it("includes an order with operation_type='order' and a pending estimated_date in range", async () => {
    const orderId = await makeOrder("confirmed", "2026-06-15");
    const { data } = await admin
      .from("orders")
      .select("id")
      .eq("operation_type", "order")
      .not("status", "in", "(delivered,cancelled)")
      .not("estimated_date", "is", null)
      .gte("estimated_date", fromIso)
      .lte("estimated_date", toIso)
      .eq("id", orderId);
    expect(data).toHaveLength(1);
  });

  it("excludes a delivered order — that delivery already happened, it's not work left to do", async () => {
    const orderId = await makeOrder("delivered", "2026-06-16");
    const { data } = await admin
      .from("orders")
      .select("id")
      .not("status", "in", "(delivered,cancelled)")
      .eq("id", orderId);
    expect(data).toHaveLength(0);
  });

  it("excludes a cancelled order", async () => {
    const orderId = await makeOrder("cancelled", "2026-06-17");
    const { data } = await admin
      .from("orders")
      .select("id")
      .not("status", "in", "(delivered,cancelled)")
      .eq("id", orderId);
    expect(data).toHaveLength(0);
  });

  it("excludes an order with no estimated_date at all", async () => {
    const orderId = await makeOrder("confirmed", null);
    const { data } = await admin
      .from("orders")
      .select("id")
      .not("estimated_date", "is", null)
      .eq("id", orderId);
    expect(data).toHaveLength(0);
  });

  it("a retail_sale (venta rápida) never has an estimated_date to begin with — architecturally can't appear on this calendar", async () => {
    const { data } = await admin
      .from("orders")
      .select("id")
      .eq("operation_type", "retail_sale")
      .not("estimated_date", "is", null);
    expect(data).toHaveLength(0);
  });
});
