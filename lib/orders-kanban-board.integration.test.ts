import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Prueba
// lo que hace getOrdersKanbanBoard() (lib/orders.ts, perf audit H-08
// bloque 3) — createClient() ahí usa cookies() (next/headers), así que
// se replica la MISMA query contra supabase-js "plano" (mismo patrón
// que el resto de tests de integración de este repo).
//
// Usa status='in_production' a propósito — el dataset local ya tiene
// ~25.000 pedidos ambiente en 'confirmed' (de otras pruebas de esta
// sesión), así que aislar el test ahí sería repetir el problema de
// contaminación ya encontrado en el bloque 2. 'in_production' no tiene
// ninguna fila ambiente hoy, así que el conteo exacto de este test es
// 100% atribuible al fixture, sin ambigüedad.

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

const KANBAN_STATUSES = ["confirmed", "in_production", "ready", "delivered"] as const;
const KANBAN_DETAIL_LIMIT = 50;
type KanbanStatus = (typeof KANBAN_STATUSES)[number];

/** Misma query que getOrdersKanbanBoard() (lib/orders.ts). */
async function fetchKanbanBoard(client: SupabaseClient, includeArchived: boolean) {
  const countResults = await Promise.all(
    KANBAN_STATUSES.map((status) => {
      let q = client
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("operation_type", "order")
        .eq("status", status);
      if (!includeArchived) q = q.is("archived_at", null);
      return q;
    })
  );
  const detailResults = await Promise.all(
    KANBAN_STATUSES.map((status) => {
      let q = client
        .from("orders")
        .select("id,human_code,status,total,created_at,archived_at")
        .eq("operation_type", "order")
        .eq("status", status);
      if (!includeArchived) q = q.is("archived_at", null);
      return q.order("created_at", { ascending: false }).limit(KANBAN_DETAIL_LIMIT);
    })
  );

  const counts = Object.fromEntries(KANBAN_STATUSES.map((s, i) => [s, countResults[i].count ?? 0])) as Record<
    KanbanStatus,
    number
  >;
  const ordersByStatus = Object.fromEntries(
    KANBAN_STATUSES.map((s, i) => [s, detailResults[i].data ?? []])
  ) as unknown as Record<KanbanStatus, { id: string; total: number }[]>;

  const allShownIds = KANBAN_STATUSES.flatMap((s) => ordersByStatus[s].map((o) => o.id));
  const { data: payments } = allShownIds.length
    ? await client.from("payments").select("order_id,amount").in("order_id", allShownIds)
    : { data: [] as { order_id: string; amount: number }[] };
  const paidByOrder: Record<string, number> = {};
  for (const p of payments ?? []) {
    paidByOrder[p.order_id] = (paidByOrder[p.order_id] ?? 0) + p.amount;
  }

  return { counts, ordersByStatus, paidByOrder };
}

describe.skipIf(!hasCredentials)("getOrdersKanbanBoard — count exacto con >1.000 pedidos activos (local)", () => {
  let admin: SupabaseClient;
  let customerId: string;
  let unitId: string;
  const FIXTURE_COUNT = 1200;
  const insertedOrderIds: string[] = [];
  let archivedOrderId: string;
  let readyOrderId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    const { data: unit } = await admin.from("business_units").select("id").eq("code", "retail").single();
    unitId = unit!.id;
    const { data: customer } = await admin.from("customers").insert({ first_name: "Kanban Board Fixture" }).select("id").single();
    customerId = customer!.id;

    // 1.200 pedidos 'in_production' — más que KANBAN_DETAIL_LIMIT (50)
    // y más que el límite de página de PostgREST (1.000), a propósito:
    // si el conteo alguna vez volviera a depender de ese límite, este
    // test lo va a mostrar.
    const rows = Array.from({ length: FIXTURE_COUNT }, (_, i) => ({
      business_unit_id: unitId,
      customer_id: customerId,
      operation_type: "order" as const,
      status: "in_production" as const,
      total: (i + 1) * 10,
    }));
    // Insertado en tandas de 200 — un solo insert de 1.200 filas es
    // válido para PostgREST, pero tandas más chicas son más robustas
    // ante cualquier límite de tamaño de request.
    for (let i = 0; i < rows.length; i += 200) {
      const { data: batch } = await admin.from("orders").insert(rows.slice(i, i + 200)).select("id");
      insertedOrderIds.push(...(batch ?? []).map((o) => o.id));
    }
    // Un pago sólo para 3 de los fixtures — el resto queda sin pagar a
    // propósito, para poder confirmar que paidByOrder no inventa nada.
    for (const orderId of insertedOrderIds.slice(0, 3)) {
      await admin.from("payments").insert({ order_id: orderId, amount: 5, paid_at: new Date().toISOString() });
    }

    // Un pedido archivado y uno 'ready' — nunca deben contarse en la
    // columna 'in_production'.
    const { data: archived } = await admin
      .from("orders")
      .insert({
        business_unit_id: unitId,
        customer_id: customerId,
        operation_type: "order",
        status: "in_production",
        total: 1,
        archived_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    archivedOrderId = archived!.id;

    const { data: ready } = await admin
      .from("orders")
      .insert({ business_unit_id: unitId, customer_id: customerId, operation_type: "order", status: "ready", total: 1 })
      .select("id")
      .single();
    readyOrderId = ready!.id;
  }, 30000);

  afterAll(async () => {
    // Nunca por lista de ids de a 1.200+ (mismo riesgo de URL larga ya
    // documentado en H-02) — payments se borra por los pocos ids que
    // realmente tienen pago (3, conocidos de antemano); orders se borra
    // por customer_id, un único marcador que cubre todo el fixture de
    // una sola vez sin importar cuántas filas sean.
    await admin.from("payments").delete().in("order_id", insertedOrderIds.slice(0, 3));
    await admin.from("orders").delete().eq("customer_id", customerId);
    await admin.from("customers").delete().eq("id", customerId);
  }, 30000);

  it("el count exacto de 'in_production' es 1.200, nunca topeado en 1.000 ni en el tope de detalle (50)", async () => {
    const board = await fetchKanbanBoard(admin, false);
    expect(board.counts.in_production).toBe(FIXTURE_COUNT);
  });

  it("el detalle mostrado nunca supera KANBAN_DETAIL_LIMIT, aunque el count real sea mucho mayor", async () => {
    const board = await fetchKanbanBoard(admin, false);
    expect(board.ordersByStatus.in_production).toHaveLength(KANBAN_DETAIL_LIMIT);
  });

  it("el pedido 'ready' nunca aparece en la columna 'in_production', ni en su count ni en su detalle", async () => {
    const board = await fetchKanbanBoard(admin, false);
    expect(board.ordersByStatus.in_production.some((o) => o.id === readyOrderId)).toBe(false);
    // El count de 'in_production' es exactamente el fixture — el
    // 'ready' fue a su propia columna, no infló esta.
    expect(board.counts.in_production).toBe(FIXTURE_COUNT);
  });

  it("un pedido archivado no se cuenta ni se muestra sin includeArchived", async () => {
    const board = await fetchKanbanBoard(admin, false);
    expect(board.ordersByStatus.in_production.some((o) => o.id === archivedOrderId)).toBe(false);
    expect(board.counts.in_production).toBe(FIXTURE_COUNT); // el archivado no suma
  });

  it("paidByOrder es correcto sólo para las tarjetas mostradas, sin inventar pagos para las que no tienen", async () => {
    const board = await fetchKanbanBoard(admin, false);
    const shownIds = new Set(board.ordersByStatus.in_production.map((o) => o.id));
    const paidFixtureIds = insertedOrderIds.slice(0, 3);
    for (const id of paidFixtureIds) {
      if (shownIds.has(id)) {
        expect(board.paidByOrder[id]).toBe(5);
      }
    }
    // Ningún pedido sin pago real tiene una entrada inventada.
    for (const order of board.ordersByStatus.in_production) {
      if (!paidFixtureIds.includes(order.id)) {
        expect(board.paidByOrder[order.id]).toBeUndefined();
      }
    }
  });
});
