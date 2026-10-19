import { describe, it, expect, vi, beforeEach } from "vitest";

// La capa TS de reportes es fina a propósito: toda la definición vive en los RPC `report_*`
// (probados contra la base en reports-definitions.integration.test.ts). Acá se prueba el contrato:
// qué argumentos se mandan, cómo se convierten los números (Postgres devuelve numeric como string),
// y que un error NUNCA se convierte en ceros.

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const {
  getReportKpis, getSalesOverTime, getSalesByBusinessUnit, getMixByChannel, getTopProducts,
  getUnitsSoldForSelection, getWholesaleConversion, getProductionCounts,
} = await import("./reports");

const filters = { from: "2030-03-01", to: "2030-03-31", businessUnitIds: ["u1", "u2"], locationId: "l1", channelId: null };

beforeEach(() => rpc.mockReset());

describe("argumentos de alcance", () => {
  it("todos los reportes mandan el mismo alcance (rango + unidades + ubicación + canal) al RPC", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await getReportKpis(filters);
    await getSalesOverTime(filters);
    await getSalesByBusinessUnit(filters);
    await getMixByChannel(filters);
    await getTopProducts(filters, 7);
    const scope = { p_from: "2030-03-01", p_to: "2030-03-31", p_business_unit_ids: ["u1", "u2"], p_location_id: "l1", p_channel_id: null };
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["report_kpis", "report_time_series", "report_by_business_unit", "report_by_channel", "report_top_products"]);
    for (const [, args] of rpc.mock.calls) expect(args).toMatchObject(scope);
    expect(rpc.mock.calls[4][1]).toMatchObject({ p_limit: 7 });
  });

  it("'Todas' viaja como null (nunca una lista vieja de ids)", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await getReportKpis({ ...filters, businessUnitIds: null, locationId: null });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_business_unit_ids: null, p_location_id: null, p_channel_id: null });
  });
});

describe("conversión de resultados", () => {
  it("KPIs: numeric (string) → number; ticket promedio null se conserva", async () => {
    rpc.mockResolvedValue({
      data: [{
        invoiced: "6100.00", orders_count: "4", avg_ticket: "1525.0000", collected_total: "5180", collected_orders: "4450",
        collected_workshops: "500", collected_other: "230", collected_on_cancelled: "700", cohort_paid: "5990",
        cohort_pending: "310", cohort_overpaid: "200", pending_total_all: "310", pending_orders_all: "1",
      }],
      error: null,
    });
    expect(await getReportKpis(filters)).toEqual({
      invoiced: 6100, ordersCount: 4, avgTicket: 1525, collectedTotal: 5180, collectedOrders: 4450, collectedWorkshops: 500,
      collectedOther: 230, collectedOnCancelled: 700, cohortPaid: 5990, cohortPending: 310, cohortOverpaid: 200, pendingTotalAll: 310, pendingOrdersAll: 1,
    });
    rpc.mockResolvedValue({ data: [{ invoiced: "0", orders_count: "0", avg_ticket: null }], error: null });
    expect((await getReportKpis(filters)).avgTicket).toBeNull();
  });

  it("serie, unidad, canal y top productos mapean a los shapes que ya consumen los gráficos", async () => {
    rpc.mockResolvedValueOnce({ data: [{ bucket: "2030-03-01", invoiced: "100", orders_count: "2", collected: "50" }], error: null });
    expect(await getSalesOverTime(filters)).toEqual([{ bucket: "2030-03-01", total: 100, ordersCount: 2, collected: 50 }]);
    rpc.mockResolvedValueOnce({ data: [{ name: "Minorista", invoiced: "4300" }], error: null });
    expect(await getSalesByBusinessUnit(filters)).toEqual([{ name: "Minorista", total: 4300 }]);
    rpc.mockResolvedValueOnce({ data: [{ name: "Sin canal", invoiced: "10" }], error: null });
    expect(await getMixByChannel(filters)).toEqual([{ name: "Sin canal", total: 10 }]);
    rpc.mockResolvedValueOnce({
      data: [
        { variant_id: "v1", label: "Taza", units: "5", revenue: "100", is_custom: false },
        { variant_id: "v2", label: "Taza", units: "2", revenue: "50", is_custom: false }, // mismo nombre, otra variante
        { variant_id: null, label: "Ítems a medida", units: "3", revenue: "1500", is_custom: true },
      ],
      error: null,
    });
    const top = await getTopProducts(filters);
    expect(top).toEqual([
      { key: "v1", label: "Taza", unitsSold: 5, revenue: 100, isCustom: false },
      { key: "v2", label: "Taza", unitsSold: 2, revenue: 50, isCustom: false },
      { key: "custom", label: "Ítems a medida", unitsSold: 3, revenue: 1500, isCustom: true },
    ]);
    // Las keys de React deben ser únicas aunque dos productos compartan nombre.
    expect(new Set(top.map((r) => r.key)).size).toBe(top.length);
  });

  it("conversión mayorista y conteos de producción", async () => {
    rpc.mockResolvedValueOnce({ data: [{ total: "4", confirmed: "3" }], error: null });
    expect(await getWholesaleConversion()).toEqual({ total: 4, confirmed: 3, conversionRate: 0.75 });
    rpc.mockResolvedValueOnce({ data: [{ total: "0", confirmed: "0" }], error: null });
    expect((await getWholesaleConversion()).conversionRate).toBe(0);
    rpc.mockResolvedValueOnce({ data: [{ status: "pending", orders_count: "5" }, { status: "done", orders_count: "2" }], error: null });
    expect(await getProductionCounts()).toEqual(new Map([["pending", 5], ["done", 2]]));
  });
});

describe("selección libre de modelos", () => {
  it("devuelve una fila por variante y el total del grupo (suma de unidades y de facturación)", async () => {
    rpc.mockResolvedValue({
      data: [
        { variant_id: "v1", product_id: "p1", label: "Taza Amalia", units: "5", revenue: "2300" },
        { variant_id: "v2", product_id: "p2", label: "Plato Bahía", units: "3", revenue: "3000" },
        { variant_id: "v3", product_id: "p3", label: "Jarrón", units: "0", revenue: "0" },
      ],
      error: null,
    });
    const result = await getUnitsSoldForSelection(filters, { productIds: ["p1", "p2", "p3"] });
    expect(result.totalUnits).toBe(8);
    expect(result.totalRevenue).toBe(5300);
    expect(result.rows).toHaveLength(3);
    expect(rpc).toHaveBeenCalledWith("report_units_sold_selection", expect.objectContaining({ p_product_ids: ["p1", "p2", "p3"], p_variant_ids: [], p_business_unit_ids: ["u1", "u2"] }));
  });

  it("una selección vacía NO llama al servidor y devuelve vacío (nunca 'todos los productos')", async () => {
    expect(await getUnitsSoldForSelection(filters, {})).toEqual({ rows: [], totalUnits: 0, totalRevenue: 0 });
    expect(await getUnitsSoldForSelection(filters, { productIds: [], variantIds: [] })).toEqual({ rows: [], totalUnits: 0, totalRevenue: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("errores", () => {
  it("un error del RPC se propaga con el nombre del reporte: NUNCA se muestran ceros en silencio", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied for function report_kpis" } });
    await expect(getReportKpis(filters)).rejects.toThrow(/Reporte report_kpis: permission denied/);
    await expect(getSalesOverTime(filters)).rejects.toThrow(/report_time_series/);
    await expect(getTopProducts(filters)).rejects.toThrow(/report_top_products/);
    await expect(getProductionCounts()).rejects.toThrow(/report_production_counts/);
  });
});
