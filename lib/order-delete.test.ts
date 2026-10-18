import { describe, it, expect } from "vitest";
import { canConfirmDelete, deleteConfirmationLabel, deleteConsequences, type DeleteInfo } from "./order-delete";

const money = (n: number) => `$${n}`;
const base: DeleteInfo = {
  level: "simple", requiresConfirmation: false, requiresReason: false,
  paymentsCount: 0, paymentsTotal: 0, productionOrdersCount: 0, stockUnitsToReturn: 0,
};
const quick: DeleteInfo = { ...base, level: "quick_sale", requiresConfirmation: true, requiresReason: true, paymentsCount: 2, paymentsTotal: 5000, stockUnitsToReturn: 3 };
const test: DeleteInfo = { ...base, level: "test_checkout", requiresConfirmation: true, requiresReason: true };

describe("deleteConsequences", () => {
  it("la eliminación simple no lista consecuencias", () => {
    expect(deleteConsequences(base, money)).toEqual([]);
  });

  it("venta rápida: pagos que se eliminan, stock que vuelve y que sale de los reportes", () => {
    const out = deleteConsequences(quick, money);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("2 pagos por $5000");
    expect(out[1]).toContain("3 unidades");
    expect(out[2]).toContain("reportes");
  });

  it("singulares: 1 pago, 1 unidad", () => {
    const out = deleteConsequences({ ...quick, paymentsCount: 1, stockUnitsToReturn: 1 }, money);
    expect(out[0]).toContain("1 pago por");
    expect(out[1]).toContain("1 unidad ");
  });

  it("producción sin tocar que se va con el pedido (nivel 2 y checkout de prueba)", () => {
    expect(deleteConsequences({ ...base, level: "untouched_production", productionOrdersCount: 2 }, money)[0]).toContain("2 órdenes de producción sin tocar");
    expect(deleteConsequences({ ...test, productionOrdersCount: 1 }, money)[0]).toContain("1 orden de producción sin tocar");
  });
});

describe("canConfirmDelete (refleja lo que exige delete_order_safe)", () => {
  const draft = { reason: "se cargó dos veces", confirmed: true, confirmCode: "MAY-000042" };

  it("sin exigencias: siempre habilitado", () => {
    expect(canConfirmDelete(base, { reason: "", confirmed: false, confirmCode: "" }, "PED-1")).toBe(true);
  });

  it("nivel 3: exige motivo, confirmación y el código", () => {
    for (const info of [quick, test]) {
      expect(canConfirmDelete(info, draft, "MAY-000042")).toBe(true);
      expect(canConfirmDelete(info, { ...draft, reason: "  " }, "MAY-000042")).toBe(false);
      expect(canConfirmDelete(info, { ...draft, confirmed: false }, "MAY-000042")).toBe(false);
      expect(canConfirmDelete(info, { ...draft, confirmCode: "" }, "MAY-000042")).toBe(false);
      expect(canConfirmDelete(info, { ...draft, confirmCode: "MAY-000043" }, "MAY-000042")).toBe(false);
    }
  });

  it("el código ignora mayúsculas y espacios alrededor", () => {
    expect(canConfirmDelete(quick, { ...draft, confirmCode: "  may-000042 " }, "MAY-000042")).toBe(true);
  });
});

describe("deleteConfirmationLabel", () => {
  it("dice 'prueba / error' para el checkout y las consecuencias para la venta rápida", () => {
    expect(deleteConfirmationLabel("test_checkout")).toMatch(/prueba/);
    expect(deleteConfirmationLabel("quick_sale")).toMatch(/stock.*pagos/);
  });
});
