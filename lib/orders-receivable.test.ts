import { describe, it, expect, vi, beforeEach } from "vitest";
import { receivableNotes, resolveBusinessUnitFilter } from "./orders-receivable";
import type { OrdersReceivable } from "./orders";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
const { getOrdersReceivable } = await import("./orders");

const units = [
  { id: "u-retail", code: "retail", name: "Minorista" },
  { id: "u-wholesale", code: "wholesale", name: "Mayorista" },
];
const money = (n: number) => `$${n}`;
const base: OrdersReceivable = {
  pendingTotal: 1000, ordersCount: 3,
  archivedPendingTotal: 0, archivedOrdersCount: 0,
  unconfirmedPendingTotal: 0, unconfirmedOrdersCount: 0,
};

describe("resolveBusinessUnitFilter", () => {
  it("resuelve por código semántico, nunca por id", () => {
    expect(resolveBusinessUnitFilter("wholesale", units)).toEqual(units[1]);
    expect(resolveBusinessUnitFilter("retail", units)).toEqual(units[0]);
  });
  it("código desconocido, vacío o ausente = todas las unidades", () => {
    for (const code of ["nope", "", null, undefined, "u-wholesale"]) expect(resolveBusinessUnitFilter(code, units)).toBeNull();
  });
});

describe("receivableNotes — el total nunca parece inconsistente con las filas visibles", () => {
  it("sin archivados ni sin confirmar: sin aclaraciones", () => {
    expect(receivableNotes({ data: base, view: "list", showArchived: false, formatMoney: money })).toEqual([]);
  });

  it("vista que oculta archivados: aclara cuánto y cuántos", () => {
    const data = { ...base, archivedPendingTotal: 400, archivedOrdersCount: 2 };
    expect(receivableNotes({ data, view: "list", showArchived: false, formatMoney: money })).toEqual([
      "Incluye $400 de 2 pedidos archivados que esta vista no muestra.",
    ]);
    expect(receivableNotes({ data: { ...data, archivedOrdersCount: 1 }, view: "kanban", showArchived: false, formatMoney: money })[0]).toContain("1 pedido archivado");
  });

  it("con 'ver archivados' activo no hay aclaración de archivados", () => {
    const data = { ...base, archivedPendingTotal: 400, archivedOrdersCount: 2 };
    expect(receivableNotes({ data, view: "list", showArchived: true, formatMoney: money })).toEqual([]);
  });

  it("Kanban aclara los sin confirmar (no se ven ahí); la Lista no", () => {
    const data = { ...base, unconfirmedPendingTotal: 250, unconfirmedOrdersCount: 1 };
    expect(receivableNotes({ data, view: "kanban", showArchived: true, formatMoney: money })).toEqual([
      "Incluye $250 de 1 pedido sin confirmar (se ven en la Lista, no en el Kanban).",
    ]);
    expect(receivableNotes({ data, view: "list", showArchived: true, formatMoney: money })).toEqual([]);
  });
});

describe("getOrdersReceivable", () => {
  beforeEach(() => rpc.mockReset());

  it("normaliza numeric/bigint (string o number) y pasa la unidad", async () => {
    rpc.mockResolvedValue({
      data: [{ pending_total: "12500.50", orders_count: "4", archived_pending_total: 100, archived_orders_count: 1, unconfirmed_pending_total: "0", unconfirmed_orders_count: 0 }],
      error: null,
    });
    expect(await getOrdersReceivable("u-wholesale")).toEqual({
      pendingTotal: 12500.5, ordersCount: 4, archivedPendingTotal: 100, archivedOrdersCount: 1, unconfirmedPendingTotal: 0, unconfirmedOrdersCount: 0,
    });
    expect(rpc).toHaveBeenCalledWith("get_orders_receivable", { p_business_unit_id: "u-wholesale" });
  });

  it("todas las unidades = null", async () => {
    rpc.mockResolvedValue({ data: [{ pending_total: 0, orders_count: 0 }], error: null });
    await getOrdersReceivable(null);
    expect(rpc).toHaveBeenCalledWith("get_orders_receivable", { p_business_unit_id: null });
  });

  it("si falla la consulta devuelve null (NUNCA un 0 inventado) y deja un log estructurado", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function not found" } });
    expect(await getOrdersReceivable(null)).toBeNull();
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ event: "orders_receivable_failed", errorCode: "PGRST202" });
    spy.mockRestore();
  });

  it("sin filas → null", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await getOrdersReceivable(null)).toBeNull();
  });
});
