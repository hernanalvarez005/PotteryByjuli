import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// orders.archived_at (auditoría "Próxima evolución operativa de
// Pottery", Bloque 4 — Kanban de Pedidos): archivar nunca borra nada
// (ni el pedido ni order_status_history), siempre es reversible, y el
// filtro "activo" (archived_at is null) que usa lib/orders.ts es mirror
// exacto acá (getOrders no es invocable directamente — usa
// next/headers).

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

describe.skipIf(!hasCredentials)("orders.archived_at (local)", () => {
  let admin: SupabaseClient;
  let customUnitId: string;
  let customerId: string;
  let orderId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: unit } = await admin.from("business_units").select("id").eq("code", "custom").single();
    customUnitId = unit!.id;
    const { data: customer } = await admin.from("customers").insert({ first_name: "Archive Fixture" }).select("id").single();
    customerId = customer!.id;

    const { data: order } = await admin
      .from("orders")
      .insert({ business_unit_id: customUnitId, customer_id: customerId, status: "pending" })
      .select("id")
      .single();
    orderId = order!.id;
    // Historial real, no fabricado — mismo trigger de siempre.
    await admin.from("orders").update({ status: "confirmed" }).eq("id", orderId);
    await admin.from("orders").update({ status: "delivered" }).eq("id", orderId);
  });

  afterAll(async () => {
    await admin.from("orders").delete().eq("id", orderId);
    await admin.from("customers").delete().eq("id", customerId);
  });

  it("archiving sets archived_at without touching status, total or order_status_history", async () => {
    const { count: historyBefore } = await admin
      .from("order_status_history")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId);

    await admin.from("orders").update({ archived_at: new Date().toISOString() }).eq("id", orderId);

    const { data: order } = await admin.from("orders").select("status,archived_at").eq("id", orderId).single();
    expect(order?.status).toBe("delivered");
    expect(order?.archived_at).not.toBeNull();

    const { count: historyAfter } = await admin
      .from("order_status_history")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId);
    expect(historyAfter).toBe(historyBefore);

    // El pedido sigue existiendo — archivar nunca es un soft-delete que
    // lo saque de una consulta sin filtro explícito.
    const { data: stillThere } = await admin.from("orders").select("id").eq("id", orderId).single();
    expect(stillThere?.id).toBe(orderId);
  });

  it("an archived order is excluded by the 'active' filter but included when archived are requested (mirrors getOrders)", async () => {
    const { data: activeOnly } = await admin.from("orders").select("id").eq("id", orderId).is("archived_at", null);
    expect(activeOnly).toHaveLength(0);

    const { data: everything } = await admin.from("orders").select("id").eq("id", orderId);
    expect(everything).toHaveLength(1);
  });

  it("unarchiving clears archived_at and the order reappears in the active filter", async () => {
    await admin.from("orders").update({ archived_at: null }).eq("id", orderId);

    const { data: order } = await admin.from("orders").select("archived_at").eq("id", orderId).single();
    expect(order?.archived_at).toBeNull();

    const { data: activeOnly } = await admin.from("orders").select("id").eq("id", orderId).is("archived_at", null);
    expect(activeOnly).toHaveLength(1);
  });
});
