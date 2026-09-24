import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupFixtures } from "@/tests/support/fixture-cleanup";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// lib/orders.ts: getOrders() usa next/headers (cookies), así que no se
// puede invocar directo en vitest — este archivo es un mirror exacto de
// su query de payments (perf audit, P0.2 — 2026-09-23), igual que el
// resto de los mirrors de esta sesión (ver
// lib/reports-mix-and-sold-at.integration.test.ts).
//
// Antes del fix, esa query era `select("order_id,amount")` sin NINGÚN
// filtro — traía cuotas de talleres, ventas minoristas y pedidos
// archivados por igual. Estos tests fijan el comportamiento correcto:
// sólo los pagos de pedidos que la pantalla realmente muestra.

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

/** Mirror exacto de la query de payments de getOrders() tras el fix —
 * filtra vía el embed `orders!inner(...)`, nunca `.in("order_id", ids)`
 * (esa forma satura la URL con miles de pedidos: probado HTTP 414 a
 * partir de ~1.500 ids).
 *
 * `scopeToOrderIds` es SÓLO para blindar estos tests contra la base
 * local compartida entre ~60 archivos de test corriendo en paralelo —
 * varios crean sus propios pedidos `operation_type='order'` al mismo
 * tiempo, y sin acotar, el resultado puede superar el límite de página
 * por default de PostgREST (1.000 filas) y dejar afuera, por pura mala
 * suerte de paginación, los ids de ESTE fixture. Nunca lo hace
 * `getOrders()` real — el propio test de "miles de pedidos" de abajo
 * corre sin este scope, justamente para probar el comportamiento real
 * sin acotar. */
async function paidByOrderMirror(
  supabase: SupabaseClient,
  options: { operationType?: "order" | "retail_sale"; includeArchived?: boolean; scopeToOrderIds?: string[] }
) {
  let paymentsQuery = supabase
    .from("payments")
    .select("order_id,amount,orders!inner(operation_type,archived_at)")
    .not("order_id", "is", null);
  if (options.operationType) {
    paymentsQuery = paymentsQuery.eq("orders.operation_type", options.operationType);
  }
  if (!options.includeArchived) {
    paymentsQuery = paymentsQuery.is("orders.archived_at", null);
  }
  if (options.scopeToOrderIds) {
    paymentsQuery = paymentsQuery.in("order_id", options.scopeToOrderIds);
  }
  const { data, error } = await paymentsQuery;
  if (error) throw error;

  const paidByOrder: Record<string, number> = {};
  for (const p of (data ?? []) as { order_id: string; amount: number }[]) {
    paidByOrder[p.order_id] = (paidByOrder[p.order_id] ?? 0) + p.amount;
  }
  return paidByOrder;
}

describe.skipIf(!hasCredentials)("getOrders() payments scoping (local)", () => {
  let admin: SupabaseClient;
  let customerId: string;
  let retailUnitId: string;
  let orderPedidoId: string; // operation_type='order', activo
  let orderArchivedId: string; // operation_type='order', archivado
  let orderRetailSaleId: string; // operation_type='retail_sale'
  let groupId: string;
  let programId: string;
  let dueId: string;
  // Ids de la venta masiva del último test — registrados acá (no sólo
  // limpiados inline al final de ese `it`) para que `afterAll` los borre
  // igual aunque una aserción de ese test falle antes de llegar a su
  // propia limpieza.
  const bulkOrderIds: string[] = [];
  // `notes` único de la venta masiva. Se registra ANTES del insert: si algo
  // falla entre el insert y el registro de ids, afterAll igual recupera los
  // pedidos por este marker exacto (único por corrida, no un patrón).
  let bulkMarker: string | null = null;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    const { data: customer } = await admin.from("customers").insert({ first_name: "Payments Scope Fixture" }).select("id").single();
    customerId = customer!.id;
    const { data: unit } = await admin.from("business_units").select("id").eq("code", "retail").single();
    retailUnitId = unit!.id;

    const { data: pedido } = await admin
      .from("orders")
      .insert({ business_unit_id: retailUnitId, customer_id: customerId, status: "confirmed", operation_type: "order" })
      .select("id")
      .single();
    orderPedidoId = pedido!.id;

    const { data: archived } = await admin
      .from("orders")
      .insert({
        business_unit_id: retailUnitId,
        customer_id: customerId,
        status: "delivered",
        operation_type: "order",
        archived_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    orderArchivedId = archived!.id;

    const { data: retailSale } = await admin
      .from("orders")
      .insert({ business_unit_id: retailUnitId, customer_id: customerId, status: "delivered", operation_type: "retail_sale" })
      .select("id")
      .single();
    orderRetailSaleId = retailSale!.id;

    // Pagos de pedido: dos pagos parciales sobre el mismo pedido (suma).
    await admin.from("payments").insert([
      { order_id: orderPedidoId, amount: 1000, paid_at: new Date().toISOString() },
      { order_id: orderPedidoId, amount: 500, paid_at: new Date().toISOString() },
    ]);
    await admin.from("payments").insert({ order_id: orderArchivedId, amount: 700, paid_at: new Date().toISOString() });
    await admin.from("payments").insert({ order_id: orderRetailSaleId, amount: 2000, paid_at: new Date().toISOString() });

    // Pago de una cuota de taller — nunca debe aparecer en ningún resultado.
    const { data: program } = await admin.from("workshop_programs").insert({ name: "Payments scope fixture program" }).select("id").single();
    programId = program!.id;
    const { data: group } = await admin.from("workshop_groups").insert({ program_id: programId, name: "Grupo scope fixture", capacity: 10 }).select("id").single();
    groupId = group!.id;
    const { data: enrollment } = await admin
      .from("workshop_enrollments")
      .insert({ group_id: groupId, customer_id: customerId, status: "active" })
      .select("id")
      .single();
    const { data: due } = await admin.from("workshop_dues").insert({ enrollment_id: enrollment!.id, period: "2026-09", amount: 45000 }).select("id").single();
    dueId = due!.id;
    await admin.from("payments").insert({ workshop_due_id: dueId, amount: 45000, paid_at: new Date().toISOString() });
  });

  // IDs exactos, en tandas de 50 (tests/support/fixture-cleanup.ts). Antes
  // los 1.800 pedidos de la venta masiva se borraban con UN `.in()` de 1.800
  // ids → HTTP 414 silencioso: cada corrida dejaba 1.800 pedidos, sus pagos
  // y un cliente "Payments Scope Fixture" (48.600 pedidos acumulados).
  afterAll(async () => {
    if (!admin) return;
    const orderIdsByMarker: string[] = [];
    if (bulkMarker) {
      for (let from = 0; ; from += 1000) {
        const { data } = await admin.from("orders").select("id").eq("notes", bulkMarker).order("id").range(from, from + 999);
        orderIdsByMarker.push(...(data ?? []).map((o) => o.id as string));
        if ((data ?? []).length < 1000) break;
      }
    }
    await cleanupFixtures(
      admin,
      "orders-payments-scope",
      {
        orderIds: [orderPedidoId, orderArchivedId, orderRetailSaleId, ...bulkOrderIds, ...orderIdsByMarker].filter(Boolean),
        customerIds: customerId ? [customerId] : [],
      },
      async (step) => {
        if (dueId) {
          await step("payments(workshop_due)", () => admin.from("payments").delete().eq("workshop_due_id", dueId));
          await step("workshop_dues", () => admin.from("workshop_dues").delete().eq("id", dueId));
        }
        if (groupId) await step("workshop_enrollments", () => admin.from("workshop_enrollments").delete().eq("group_id", groupId));
        if (groupId) await step("workshop_groups", () => admin.from("workshop_groups").delete().eq("id", groupId));
        if (programId) await step("workshop_programs", () => admin.from("workshop_programs").delete().eq("id", programId));
      }
    );
  });

  // Las primeras 4 aserciones se acotan con `scopeToOrderIds` a los ids de
  // ESTE fixture (ver el comentario del mirror) — nunca cambia qué
  // filtro real se ejercita (operation_type/archived_at vía el embed),
  // sólo evita que la base local compartida entre archivos de test
  // paralelos haga caer estos 3-4 ids fuera de una página de 1.000.
  const fixtureIds = () => [orderPedidoId, orderArchivedId, orderRetailSaleId];

  it("/pedidos (operation_type='order', no archivados): suma los pagos parciales del pedido activo, excluye cuotas/ventas/archivados", async () => {
    const paidByOrder = await paidByOrderMirror(admin, {
      operationType: "order",
      includeArchived: false,
      scopeToOrderIds: fixtureIds(),
    });
    expect(paidByOrder[orderPedidoId]).toBe(1500);
    expect(paidByOrder[orderArchivedId]).toBeUndefined();
    expect(paidByOrder[orderRetailSaleId]).toBeUndefined();
    expect(Object.values(paidByOrder)).not.toContain(45000); // el pago de la cuota nunca aparece
  });

  it("/pedidos con 'Ver archivados': incluye también el pedido archivado", async () => {
    const paidByOrder = await paidByOrderMirror(admin, {
      operationType: "order",
      includeArchived: true,
      scopeToOrderIds: fixtureIds(),
    });
    expect(paidByOrder[orderPedidoId]).toBe(1500);
    expect(paidByOrder[orderArchivedId]).toBe(700);
    expect(paidByOrder[orderRetailSaleId]).toBeUndefined();
  });

  it("/ventas (operation_type='retail_sale'): sólo el pago de la venta minorista, nunca el del pedido ni el de la cuota", async () => {
    const paidByOrder = await paidByOrderMirror(admin, { operationType: "retail_sale", scopeToOrderIds: fixtureIds() });
    expect(paidByOrder[orderRetailSaleId]).toBe(2000);
    expect(paidByOrder[orderPedidoId]).toBeUndefined();
    expect(paidByOrder[orderArchivedId]).toBeUndefined();
  });

  it("nunca trae más pagos que pedidos coincidentes con el filtro (la regresión que motivó el fix)", async () => {
    const paidByOrder = await paidByOrderMirror(admin, {
      operationType: "order",
      includeArchived: false,
      scopeToOrderIds: fixtureIds(),
    });
    // Antes del fix (sin ningún filtro) esto habría incluido el pago de
    // la venta minorista (2000) además del pedido activo — acá se prueba
    // exactamente eso, dentro del scope de este fixture.
    expect(Object.keys(paidByOrder)).toEqual([orderPedidoId]);
  });

  // No basta con que el fix funcione con pocos pedidos — la alternativa
  // obvia (`.in("order_id", orderIds)`) se probó primero contra este mismo
  // dataset y rompió con HTTP 414 (URI demasiado larga) a partir de
  // ~1.500 ids reales (74.000 caracteres de query string). Este test
  // prueba la escala donde esa alternativa ya habría roto: 1.800 pedidos
  // coincidentes es más que suficiente para superar ese umbral si el
  // fix hubiera mandado una lista de ids por la URL. La respuesta sigue
  // siendo 200 y los montos correctos, porque el filtro por embed nunca
  // crece con la cantidad de filas que matchea — sólo manda
  // "operation_type=eq.order&archived_at=is.null", constante sin importar
  // si matchean 3 pedidos o 300.000.
  //
  // La verificación se acota con un `notes` único de esta corrida (nunca
  // con `.in("order_id", bulkIds)` — eso reintroduciría el mismo
  // problema de URL que el test prueba que no existe) — así el resultado
  // es determinístico sin depender de en qué página arbitraria de 1.000
  // filas (el límite de página por default de PostgREST, preexistente e
  // independiente de este fix — paginar /pedidos es P4, no P0) caigan
  // estos pedidos cuando ~60 archivos de test corren en paralelo contra
  // la misma base local y varios crean sus propios pedidos
  // `operation_type='order'` al mismo tiempo.
  it("sigue funcionando con miles de pedidos coincidentes — nunca manda una lista de ids por la URL", async () => {
    const marker = `perf-audit-bulk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    bulkMarker = marker;
    const bulkOrders = Array.from({ length: 1800 }, () => ({
      business_unit_id: retailUnitId,
      customer_id: customerId,
      status: "confirmed" as const,
      operation_type: "order" as const,
      notes: marker,
    }));
    const { data: created, error } = await admin.from("orders").insert(bulkOrders).select("id");
    expect(error).toBeNull();
    const bulkIds = (created ?? []).map((o) => o.id as string);
    bulkOrderIds.push(...bulkIds); // registrado ya — afterAll limpia esto aunque falle una aserción de acá abajo

    await admin.from("payments").insert(
      bulkIds.map((id) => ({ order_id: id, amount: 100, paid_at: new Date().toISOString() }))
    );

    const { data, error: queryError } = await admin
      .from("payments")
      .select("order_id,amount,orders!inner(operation_type,archived_at,notes)")
      .not("order_id", "is", null)
      .eq("orders.operation_type", "order")
      .is("orders.archived_at", null)
      .eq("orders.notes", marker);
    // Nunca un error/HTTP 414 — la query nunca creció con la cantidad de
    // pedidos que matchea, sólo con el criterio del filtro (constante).
    expect(queryError).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((p) => p.amount === 100)).toBe(true);

    // Sin limpieza inline: un `.in()` de 1.800 ids revienta la URL (414).
    // afterAll borra estos pedidos en tandas de 50 aunque una aserción falle.
  });
});
