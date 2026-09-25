import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Guardia de la "única fuente de verdad" del KPI "Pendiente de cobrar":
// /pedidos lo pide UNA vez y le pasa el mismo valor a Lista y Kanban; ninguna
// vista lo recalcula (ni suma `total`, ni baja pagos), y el mismo filtro de
// unidad alimenta a las tres consultas. Un cambio que reintroduzca un cálculo
// por vista o un filtro que sólo aplique a una se nota de inmediato.
const read = (relative: string) => readFileSync(path.resolve(__dirname, "..", relative), "utf-8");

describe("Pendiente de cobrar: una sola fuente de verdad", () => {
  const page = read("app/(app)/pedidos/page.tsx");

  it("la página pide el KPI UNA sola vez, antes de elegir vista", () => {
    expect(page.match(/getOrdersReceivable\(/g)).toHaveLength(1);
    expect(page.indexOf("getOrdersReceivable(")).toBeLessThan(page.indexOf("getOrdersKanbanBoard("));
    expect(page.indexOf("getOrdersReceivable(")).toBeLessThan(page.indexOf("getOrdersPage("));
  });

  it("el MISMO businessUnitId filtra Lista, Kanban y KPI", () => {
    expect(page).toMatch(/getOrdersReceivable\(businessUnitId\)/);
    expect(page).toMatch(/getOrdersKanbanBoard\(\{[^}]*businessUnitId[^}]*\}\)/);
    expect(page).toMatch(/getOrdersPage\(\{[^}]*businessUnitId[^}]*\}/);
  });

  it("el Kanban no calcula el KPI por su cuenta", () => {
    const kanban = read("app/(app)/pedidos/pedidos-kanban.tsx");
    expect(kanban).not.toMatch(/getOrdersReceivable|get_orders_receivable|pendingTotal/);
  });

  it("el saldo agregado sale de la base (RPC), no de sumar orders.total ni descargar pagos", () => {
    const lib = read("lib/orders.ts");
    const fn = lib.slice(lib.indexOf("export async function getOrdersReceivable"));
    expect(fn).toContain('rpc("get_orders_receivable"');
    expect(fn).not.toMatch(/from\("payments"\)|from\("orders"\)/);
  });
});
