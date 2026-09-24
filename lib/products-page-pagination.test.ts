import { describe, it, expect, vi, beforeEach } from "vitest";

// Unitario, cliente mockeado — mismo motivo que
// orders-page-pagination.test.ts: el caso límite "el total es un
// múltiplo exacto de pageSize" no se puede aislar limpio contra
// Supabase local (el dataset ya tiene miles de productos reales de
// sesiones anteriores). El patrón "peek" (pedir pageSize+1 y recortar)
// es el mismo que getOrdersPage() — se prueba acá de nuevo porque es una
// implementación independiente, no una función compartida.

type QueryResult = { data: unknown };

function makeProductsBuilder(rows: unknown[]) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    ilike: () => builder,
    order: () => builder,
    limit: (n: number) => makeProductsBuilder(rows.slice(0, n)),
    or: () => builder,
    then: (resolve: (v: QueryResult) => void) => Promise.resolve({ data: rows }).then(resolve),
  };
  return builder;
}

function makePricesBuilder(rows: unknown[]) {
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

const { getProductsPage } = await import("./products");

function fakeProduct(i: number) {
  const id = `product-${String(i).padStart(4, "0")}`;
  return {
    id,
    name: `Producto ${String(i).padStart(4, "0")}`,
    description: null,
    cost_estimate: null,
    is_active: true,
    category_id: null,
    product_categories: null,
    product_variants: [{ id: `${id}-v1`, name: "Única", sku: null, is_active: true }],
  };
}

beforeEach(() => {
  mockFrom.mockReset();
});

describe("getProductsPage — casos límite de paginación (mock)", () => {
  it("nextCursor es null cuando el total es exactamente pageSize", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => fakeProduct(i + 1));
    mockFrom
      .mockReturnValueOnce(makeProductsBuilder(rows)) // products: limit(11) sobre 10 reales → 10
      .mockReturnValueOnce(makePricesBuilder([])); // price_list_items

    const { products, nextCursor } = await getProductsPage("active", "", null, 10);
    expect(products).toHaveLength(10);
    expect(nextCursor).toBeNull();
  });

  it("nextCursor NO es null cuando hay exactamente una fila más allá de pageSize", async () => {
    const rows = Array.from({ length: 11 }, (_, i) => fakeProduct(i + 1));
    mockFrom
      .mockReturnValueOnce(makeProductsBuilder(rows))
      .mockReturnValueOnce(makePricesBuilder([]));

    const { products, nextCursor } = await getProductsPage("active", "", null, 10);
    expect(products).toHaveLength(10); // nunca se muestra la fila de peek
    expect(nextCursor).not.toBeNull();
    expect(nextCursor!.id).toBe("product-0010"); // cursor = última fila MOSTRADA, no la de peek
  });

  it("nextCursor es null cuando hay menos filas que pageSize", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => fakeProduct(i + 1));
    mockFrom
      .mockReturnValueOnce(makeProductsBuilder(rows))
      .mockReturnValueOnce(makePricesBuilder([]));

    const { products, nextCursor } = await getProductsPage("active", "", null, 10);
    expect(products).toHaveLength(3);
    expect(nextCursor).toBeNull();
  });

  it("no pide precios si la página vino vacía", async () => {
    mockFrom.mockReturnValueOnce(makeProductsBuilder([]));

    const { products, prices, nextCursor } = await getProductsPage("active", "", null, 10);
    expect(products).toHaveLength(0);
    expect(prices).toEqual({});
    expect(nextCursor).toBeNull();
    expect(mockFrom).toHaveBeenCalledTimes(1); // nunca llamó a price_list_items
  });

  it("los precios de la página se resuelven sólo para las variantes de esta página, nunca del catálogo completo", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => fakeProduct(i + 1));
    const priceRows = [
      { product_variant_id: "product-0001-v1", unit_price: 1000, price_lists: { code: "retail" } },
      { product_variant_id: "product-0002-v1", unit_price: 2000, price_lists: { code: "wholesale" } },
    ];
    mockFrom
      .mockReturnValueOnce(makeProductsBuilder(rows))
      .mockReturnValueOnce(makePricesBuilder(priceRows));

    const { prices } = await getProductsPage("active", "", null, 10);
    expect(prices["product-0001-v1"]).toEqual({ retail: 1000 });
    expect(prices["product-0002-v1"]).toEqual({ wholesale: 2000 });
    expect(prices["product-0003-v1"]).toBeUndefined();
  });
});
