import { describe, it, expect, vi, beforeEach } from "vitest";

// Un error de backend nunca debe verse como "sin resultados" — esa es la
// garantía puntual que este test unitario (con un cliente mockeado)
// verifica de forma determinística. La correctitud real de las queries
// (qué encuentra, qué excluye) la cubre product-search.integration.test.ts
// contra Supabase local de verdad.

type QueryResult = { data: unknown; error: unknown };

function makeBuilder(result: QueryResult) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    ilike: () => builder,
    in: () => builder,
    limit: () => builder,
    then: (resolve: (v: QueryResult) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: mockFrom }),
}));

const { searchSaleVariants, searchOrderVariants, resolveSaleVariantsByIds } = await import("./product-search");

beforeEach(() => {
  mockFrom.mockReset();
});

describe("searchSaleVariants", () => {
  it("returns { results: [] } without querying when the term is shorter than the minimum", async () => {
    const outcome = await searchSaleVariants("a");
    expect(outcome).toEqual({ results: [] });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns { error: true } when either parallel query fails — never confused with zero results", async () => {
    mockFrom
      .mockReturnValueOnce(makeBuilder({ data: null, error: { message: "network down" } }))
      .mockReturnValueOnce(makeBuilder({ data: [], error: null }));

    const outcome = await searchSaleVariants("taza");
    expect(outcome).toEqual({ error: true });
    // Nunca el mismo shape que "sin resultados":
    expect(outcome).not.toEqual({ results: [] });
  });

  it("merges and dedupes matches from both queries, capped at 20", async () => {
    const row = (id: string) => ({
      id,
      name: "Único",
      products: { name: `Producto ${id}` },
      price_list_items: [{ unit_price: 1000 }],
    });
    const shared = row("dup-1");
    const byProductRows = [shared, row("only-product")];
    const byVariantRows = [shared, row("only-variant")];

    mockFrom
      .mockReturnValueOnce(makeBuilder({ data: byProductRows, error: null }))
      .mockReturnValueOnce(makeBuilder({ data: byVariantRows, error: null }));

    const outcome = await searchSaleVariants("taza");
    if ("error" in outcome) throw new Error("expected success");
    const ids = outcome.results.map((r) => r.id);
    expect(ids).toEqual(["dup-1", "only-product", "only-variant"]); // sin duplicados
  });

  it("drops a row with no retail price or missing product join instead of crashing", async () => {
    const rows = [
      { id: "no-price", name: "Único", products: { name: "Sin precio" }, price_list_items: [] },
      { id: "ok", name: "Único", products: { name: "Con precio" }, price_list_items: [{ unit_price: 500 }] },
    ];
    mockFrom
      .mockReturnValueOnce(makeBuilder({ data: rows, error: null }))
      .mockReturnValueOnce(makeBuilder({ data: [], error: null }));

    const outcome = await searchSaleVariants("taza");
    if ("error" in outcome) throw new Error("expected success");
    expect(outcome.results.map((r) => r.id)).toEqual(["ok"]);
  });
});

describe("resolveSaleVariantsByIds", () => {
  it("returns an empty array without querying for an empty id list", async () => {
    const result = await resolveSaleVariantsByIds([]);
    expect(result).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("never throws on a backend error — degrades to an empty list", async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: null, error: { message: "boom" } }));
    const result = await resolveSaleVariantsByIds(["11111111-1111-4111-8111-111111111111"]);
    expect(result).toEqual([]);
  });

  it("preserves the input id order (most frequent first), not the DB's own order", async () => {
    const rowFor = (id: string) => ({
      id,
      name: "Único",
      products: { name: `Producto ${id}` },
      price_list_items: [{ unit_price: 100 }],
    });
    // La base los devuelve en otro orden a propósito.
    mockFrom.mockReturnValueOnce(makeBuilder({ data: [rowFor("b"), rowFor("a")], error: null }));

    const result = await resolveSaleVariantsByIds(["a", "b"]);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("searchOrderVariants (/pedidos/nuevo)", () => {
  const priced = (code: string, unit_price: number) => ({ unit_price, price_lists: { code } });

  it("does not query for a term shorter than the minimum", async () => {
    expect(await searchOrderVariants("a")).toEqual({ results: [] });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns both list prices per variant, ignoring other price lists", async () => {
    const rows = [
      {
        id: "v1",
        name: "Bordó",
        products: { name: "Taza" },
        price_list_items: [priced("retail", 10000), priced("wholesale", 6000), priced("restricted-x", 1)],
      },
    ];
    mockFrom
      .mockReturnValueOnce(makeBuilder({ data: rows, error: null }))
      .mockReturnValueOnce(makeBuilder({ data: [], error: null }));

    const outcome = await searchOrderVariants("taza");
    if ("error" in outcome) throw new Error("expected success");
    expect(outcome.results).toEqual([{ id: "v1", label: "Taza — Bordó", prices: { retail: 10000, wholesale: 6000 } }]);
  });

  it("keeps a variant with no price in a list (null) instead of dropping it", async () => {
    const rows = [
      { id: "only-retail", name: "Único", products: { name: "Plato" }, price_list_items: [priced("retail", 8000)] },
      { id: "no-prices", name: "Único", products: { name: "Jarra" }, price_list_items: [] },
    ];
    mockFrom
      .mockReturnValueOnce(makeBuilder({ data: rows, error: null }))
      .mockReturnValueOnce(makeBuilder({ data: [], error: null }));

    const outcome = await searchOrderVariants("a b");
    if ("error" in outcome) throw new Error("expected success");
    expect(outcome.results).toEqual([
      { id: "only-retail", label: "Plato", prices: { retail: 8000, wholesale: null } },
      { id: "no-prices", label: "Jarra", prices: { retail: null, wholesale: null } },
    ]);
  });

  it("returns { error: true } on a backend failure — never confused with zero results", async () => {
    mockFrom
      .mockReturnValueOnce(makeBuilder({ data: null, error: { message: "down" } }))
      .mockReturnValueOnce(makeBuilder({ data: [], error: null }));
    expect(await searchOrderVariants("taza")).toEqual({ error: true });
  });
});
