import { describe, it, expect, vi, beforeEach } from "vitest";

// Unitario, cliente mockeado — sin esto, probar el caso límite "el total
// es un múltiplo exacto de pageSize" contra Supabase local es imposible
// de aislar limpio: el dataset local ya tiene miles de pedidos reales
// con operation_type='order', así que "esta es realmente la última
// página" nunca se puede garantizar con datos compartidos (ver
// orders-pagination.integration.test.ts, que sí prueba contra datos
// reales lo que SÍ se puede aislar: orden estable con timestamps
// idénticos, y paidByOrder correcto).
//
// Bug real encontrado con este mismo test durante esta sesión: sin el
// patrón "pedir pageSize+1 y recortar" (peek), nextCursor quedaba
// no-nulo aunque la página devuelta fuera exactamente la última —
// porque `orders.length === pageSize` no distingue "exactamente esto
// hay" de "hay más".

type QueryResult = { data: unknown };

function makeOrdersBuilder(rows: unknown[]) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    limit: (n: number) => makeOrdersBuilder(rows.slice(0, n)),
    or: () => builder,
    in: () => builder,
    then: (resolve: (v: QueryResult) => void) => Promise.resolve({ data: rows }).then(resolve),
  };
  return builder;
}

function makePaymentsBuilder(rows: unknown[]) {
  const builder = {
    select: () => builder,
    in: () => builder,
    then: (resolve: (v: QueryResult) => void) => Promise.resolve({ data: rows }).then(resolve),
  };
  return builder;
}

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: mockFrom }),
}));

const { getOrdersPage } = await import("./orders");

function fakeOrder(i: number) {
  return {
    id: `order-${String(i).padStart(3, "0")}`,
    human_code: `PED-${i}`,
    status: "delivered",
    total: i * 100,
    created_at: `2026-01-${String(i).padStart(2, "0")}T12:00:00Z`,
    estimated_date: null,
    archived_at: null,
    customers: null,
    business_units: null,
  };
}

beforeEach(() => {
  mockFrom.mockReset();
});

describe("getOrdersPage — casos límite de paginación (mock)", () => {
  it("nextCursor es null cuando el total es exactamente pageSize (no un múltiplo con resto)", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => fakeOrder(i + 1)); // exactamente 10
    mockFrom
      .mockReturnValueOnce(makeOrdersBuilder(rows)) // orders: limit(11) sobre 10 filas reales → devuelve 10
      .mockReturnValueOnce(makePaymentsBuilder([])); // payments

    const { orders, nextCursor } = await getOrdersPage({ operationType: "order" }, null, 10);
    expect(orders).toHaveLength(10);
    expect(nextCursor).toBeNull();
  });

  it("nextCursor NO es null cuando hay exactamente una fila más allá de pageSize (el caso que rompía antes del fix)", async () => {
    const rows = Array.from({ length: 11 }, (_, i) => fakeOrder(i + 1)); // 11 — pageSize+1 exacto
    mockFrom
      .mockReturnValueOnce(makeOrdersBuilder(rows))
      .mockReturnValueOnce(makePaymentsBuilder([]));

    const { orders, nextCursor } = await getOrdersPage({ operationType: "order" }, null, 10);
    expect(orders).toHaveLength(10); // nunca se muestra la fila de peek
    expect(nextCursor).not.toBeNull();
    expect(nextCursor!.id).toBe("order-010"); // el cursor es la ÚLTIMA fila MOSTRADA, no la de peek
  });

  it("nextCursor es null cuando hay menos filas que pageSize", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => fakeOrder(i + 1));
    mockFrom
      .mockReturnValueOnce(makeOrdersBuilder(rows))
      .mockReturnValueOnce(makePaymentsBuilder([]));

    const { orders, nextCursor } = await getOrdersPage({ operationType: "order" }, null, 10);
    expect(orders).toHaveLength(3);
    expect(nextCursor).toBeNull();
  });

  it("paidByOrder nunca pide pagos si la página vino vacía", async () => {
    mockFrom.mockReturnValueOnce(makeOrdersBuilder([]));

    const { orders, paidByOrder, nextCursor } = await getOrdersPage({ operationType: "order" }, null, 10);
    expect(orders).toHaveLength(0);
    expect(paidByOrder).toEqual({});
    expect(nextCursor).toBeNull();
    expect(mockFrom).toHaveBeenCalledTimes(1); // nunca llamó a payments
  });
});
