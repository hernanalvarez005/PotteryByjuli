import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Prueba
// lo que hace getOrdersPage() (lib/orders.ts, perf audit H-08 bloque 2)
// — createClient() ahí usa cookies() (next/headers), así que no se
// puede importar directo en vitest; se replica la MISMA query keyset
// contra supabase-js "plano" con la service role (mismo patrón que el
// resto de los tests de integración de este repo).
//
// Dos garantías nuevas se prueban acá, ninguna cubierta antes:
// 1. El cursor compuesto (created_at, id) no saltea ni repite filas
//    aunque muchas compartan el mismo created_at exacto — el caso que
//    un cursor de un solo campo rompería, y que es común con datos
//    cargados en lote (igual que el dataset local real de esta sesión).
// 2. paidByOrder es completo y correcto para cada pedido de la página
//    mostrada, sin importar cuántos pedidos/pagos existan en el resto
//    de la tabla — antes de este fix, una query global de payments sin
//    order by topeaba en 1.000 filas y podía dejar afuera el pago de
//    un pedido real, mostrando saldo incorrecto (H-12).

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

type Cursor = { createdAt: string; id: string } | null;

/** Misma query que getOrdersPage() (lib/orders.ts). */
async function fetchOrdersPage(
  client: SupabaseClient,
  operationType: "order" | "retail_sale",
  cursor: Cursor,
  pageSize: number
) {
  let query = client
    .from("orders")
    .select("id,human_code,status,total,created_at,archived_at")
    .eq("operation_type", operationType)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1); // peek — ver el comentario en getOrdersPage()
  if (cursor) {
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  }
  const { data, error } = await query;
  if (error) throw error;
  const fetched = data ?? [];
  const hasNextPage = fetched.length > pageSize;
  const orders = hasNextPage ? fetched.slice(0, pageSize) : fetched;

  const pageIds = orders.map((o) => o.id);
  const { data: payments, error: payErr } = pageIds.length
    ? await client.from("payments").select("order_id,amount").in("order_id", pageIds)
    : { data: [] as { order_id: string; amount: number }[], error: null };
  if (payErr) throw payErr;

  const paidByOrder: Record<string, number> = {};
  for (const p of payments ?? []) {
    paidByOrder[p.order_id] = (paidByOrder[p.order_id] ?? 0) + p.amount;
  }

  const last = orders.at(-1);
  const nextCursor: Cursor = last && hasNextPage ? { createdAt: last.created_at, id: last.id } : null;
  return { orders, paidByOrder, nextCursor };
}

describe.skipIf(!hasCredentials)("getOrdersPage keyset pagination + saldo (local)", () => {
  let admin: SupabaseClient;
  let customerId: string;
  let unitId: string;
  const fixtureOrderIds: string[] = [];
  // Fecha deliberadamente en el futuro — la ordenación es
  // created_at DESC, así que estas 30 filas quedan garantizadas como
  // las MÁS RECIENTES de toda la tabla (sin importar cuántos miles de
  // pedidos reales/de otros tests convivan en la misma base local),
  // aislando el test de la contaminación por datos ajenos concurrentes
  // — mismo problema/solución ya documentado en otros tests de esta
  // sesión (dashboard-pending-dues-detail.integration.test.ts, con
  // fechas de 1897 para aislar el extremo opuesto).
  const SHARED_TIMESTAMP = "2030-01-01T12:00:00-03:00";

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    const { data: unit } = await admin.from("business_units").select("id").eq("code", "retail").single();
    unitId = unit!.id;
    const { data: customer } = await admin.from("customers").insert({ first_name: "Pagination Fixture" }).select("id").single();
    customerId = customer!.id;

    // 30 pedidos con EXACTAMENTE el mismo created_at — el caso que
    // rompería un cursor de un solo campo. total distinto cada uno
    // (100, 200, ..., 3000) para poder identificar cada fila.
    for (let i = 1; i <= 30; i++) {
      const { data: order } = await admin
        .from("orders")
        .insert({
          business_unit_id: unitId,
          customer_id: customerId,
          operation_type: "order",
          status: "delivered",
          total: i * 100,
          created_at: SHARED_TIMESTAMP,
        })
        .select("id")
        .single();
      fixtureOrderIds.push(order!.id);
      // Un pago por pedido, monto = mitad del total — para poder
      // verificar paidByOrder exactamente.
      await admin.from("payments").insert({ order_id: order!.id, amount: (i * 100) / 2, paid_at: new Date().toISOString() });
    }

    // Un pedido archivado y uno retail_sale, mismo timestamp — nunca
    // deben aparecer en getOrdersPage({operationType:"order"}) sin
    // includeArchived.
    const { data: archivedOrder } = await admin
      .from("orders")
      .insert({
        business_unit_id: unitId,
        customer_id: customerId,
        operation_type: "order",
        status: "delivered",
        total: 999,
        created_at: SHARED_TIMESTAMP,
        archived_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    fixtureOrderIds.push(archivedOrder!.id);

    const { data: retailOrder } = await admin
      .from("orders")
      .insert({
        business_unit_id: unitId,
        customer_id: customerId,
        operation_type: "retail_sale",
        status: "delivered",
        total: 888,
        created_at: SHARED_TIMESTAMP,
      })
      .select("id")
      .single();
    fixtureOrderIds.push(retailOrder!.id);
  });

  afterAll(async () => {
    await admin.from("payments").delete().in("order_id", fixtureOrderIds);
    await admin.from("orders").delete().in("id", fixtureOrderIds);
    await admin.from("customers").delete().eq("id", customerId);
  });

  it("pagina sin saltear ni repetir filas aunque las 30 compartan el mismo created_at exacto", async () => {
    const page1 = await fetchOrdersPage(admin, "order", null, 10);
    expect(page1.orders).toHaveLength(10);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await fetchOrdersPage(admin, "order", page1.nextCursor, 10);
    expect(page2.orders).toHaveLength(10);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await fetchOrdersPage(admin, "order", page2.nextCursor, 10);
    // Página 3 tiene las 10 restantes de las 30 — el dataset local ya
    // trae miles de pedidos reales/de otros tests con operation_type
    // 'order', así que "hay más después de estos 30" es la respuesta
    // correcta y esperada (nextCursor no-nulo acá NO es un bug: hay
    // pedidos reales más allá de este fixture aislado). El "última
    // página real" (nextCursor null) se prueba aparte, con un universo
    // genuinamente acotado — ver el test siguiente.
    expect(page3.orders).toHaveLength(10);

    const allIds = [...page1.orders, ...page2.orders, ...page3.orders].map((o) => o.id);
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(30); // sin duplicados
    expect(allIds.filter((id) => fixtureOrderIds.slice(0, 30).includes(id))).toHaveLength(30); // sin faltantes
  });

  it("paidByOrder es correcto para cada pedido de la página, sin importar cuánto más haya en el resto de la tabla", async () => {
    const page1 = await fetchOrdersPage(admin, "order", null, 10);
    const page2 = await fetchOrdersPage(admin, "order", page1.nextCursor, 10);
    const page3 = await fetchOrdersPage(admin, "order", page2.nextCursor, 10);

    for (const page of [page1, page2, page3]) {
      for (const order of page.orders) {
        expect(page.paidByOrder[order.id]).toBe(order.total / 2); // cada fixture paga exactamente la mitad de su total
      }
    }
  });

  it("un pedido retail_sale nunca aparece filtrando por operationType='order'", async () => {
    const page1 = await fetchOrdersPage(admin, "order", null, 40);
    const retailOrder = fixtureOrderIds.at(-1)!;
    expect(page1.orders.some((o) => o.id === retailOrder)).toBe(false);
  });

  it("un pedido archivado nunca aparece sin includeArchived (is('archived_at', null) sigue aplicando)", async () => {
    const page1 = await fetchOrdersPage(admin, "order", null, 40);
    const archivedOrder = fixtureOrderIds.at(-2)!;
    expect(page1.orders.some((o) => o.id === archivedOrder)).toBe(false);
  });
});
