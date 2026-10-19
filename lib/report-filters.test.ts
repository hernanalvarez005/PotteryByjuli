import { describe, it, expect } from "vitest";
import { parseIdList, parseReportFilters, seriesFrom, defaultReportFilters } from "./report-filters";
import { bucketLabel, collectedVsPending } from "./report-view";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const defaults = { from: "2026-10-01", to: "2026-10-31", businessUnitIds: null, locationId: null, channelId: null };

describe("parseReportFilters", () => {
  it("sin parámetros: los defaults ('Todas' = null)", () => {
    expect(parseReportFilters({}, defaults)).toEqual(defaults);
  });

  it("toma rango, unidades, ubicación y canal válidos", () => {
    expect(parseReportFilters({ from: "2026-01-01", to: "2026-03-31", business_units: `${U1},${U2}`, location: U1, channel: U2 }, defaults)).toEqual({
      from: "2026-01-01", to: "2026-03-31", businessUnitIds: [U1, U2], locationId: U1, channelId: U2,
    });
  });

  it("valores inválidos caen al default (nunca rompen): fechas mal formadas o imposibles, ids que no son uuid", () => {
    const f = parseReportFilters({ from: "ayer", to: "2026-02-31", business_units: "x,y", location: "abc", channel: "1" }, defaults);
    expect(f).toEqual(defaults);
  });

  it("un rango invertido se acomoda en vez de devolver vacío", () => {
    const f = parseReportFilters({ from: "2026-05-10", to: "2026-05-01" }, defaults);
    expect([f.from, f.to]).toEqual(["2026-05-01", "2026-05-10"]);
  });

  it("parseIdList: sin repetidos, ignora basura, respeta el máximo", () => {
    expect(parseIdList(`${U1},${U1}, ${U2} ,nope,`)).toEqual([U1, U2]);
    expect(parseIdList(undefined)).toEqual([]);
    expect(parseIdList(`${U1},${U2}`, 1)).toEqual([U1]);
  });

  it("el default de /reportes es lo que va del año", () => {
    const d = defaultReportFilters();
    expect(d.from).toMatch(/^\d{4}-01-01$/);
    expect(d.to >= d.from).toBe(true);
    expect(d.businessUnitIds).toBeNull();
  });
});

describe("seriesFrom", () => {
  it("arranca en la primera actividad si es posterior al 'desde' pedido (todo el histórico no genera cientos de meses en 0)", () => {
    expect(seriesFrom("2000-01-01", "2025-03-10")).toBe("2025-03-10");
  });
  it("respeta el 'desde' pedido si es posterior, o si no hay actividad", () => {
    expect(seriesFrom("2026-01-01", "2025-03-10")).toBe("2026-01-01");
    expect(seriesFrom("2026-01-01", null)).toBe("2026-01-01");
  });
});

describe("collectedVsPending", () => {
  it("cobrado + pendiente == facturación (la identidad con el sobrepago descontado)", () => {
    const v = collectedVsPending({ invoiced: 6100, cohortPaid: 5990, cohortOverpaid: 200, cohortPending: 310 });
    expect(v.collected).toBe(5790);
    expect(v.pending).toBe(310);
    expect(v.collected + v.pending).toBe(6100);
    expect(v.collectedPct + v.pendingPct).toBeCloseTo(100, 0);
    expect(v.overpaid).toBe(200);
  });
  it("sin facturación: ceros, sin dividir por 0", () => {
    expect(collectedVsPending({ invoiced: 0, cohortPaid: 0, cohortOverpaid: 0, cohortPending: 0 })).toMatchObject({ collectedPct: 0, pendingPct: 0 });
  });
});

describe("bucketLabel", () => {
  it("mensual y diario", () => {
    expect(bucketLabel("2026-09")).toBe("09/26");
    expect(bucketLabel("2026-09-04")).toBe("04/09");
  });
});
