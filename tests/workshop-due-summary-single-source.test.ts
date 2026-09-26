import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Regression guard for the "única fuente de verdad" requirement (precisión
// de la usuaria en la tanda de mejoras operativas — sección 7):
// computeDueSummary debe ser la única función que calcula el total de una
// cuota, y los cuatro consumidores (Talleres, cuotas, ficha de alumna,
// dashboard/reportes) deben llamarla — nunca reimplementar la suma de
// extras/pagos por su cuenta. lib/workshop-dues.test.ts ya prueba
// computeDueSummary exhaustivamente; esto confirma estáticamente que cada
// consumidor real efectivamente la usa, para que un futuro cambio que
// reintroduzca un cálculo paralelo se note de inmediato.
const CONSUMERS = [
  "app/(app)/talleres/[groupId]/page.tsx",
  "app/(app)/talleres/cuotas/page.tsx",
  "app/(app)/clientes/[id]/page.tsx",
  "lib/students.ts",
];

describe("every workshop-due-total consumer calls computeDueSummary", () => {
  for (const relativePath of CONSUMERS) {
    it(`${relativePath} imports and calls computeDueSummary`, () => {
      const filePath = path.resolve(__dirname, "..", relativePath);
      const source = readFileSync(filePath, "utf-8");
      expect(source).toMatch(/computeDueSummary/);
      expect(source).toMatch(/computeDueSummary\(/);
    });
  }
});

// EXENCIÓN de la cuota base (workshop_due_waivers): si un consumidor olvida
// pedir los ciclos de exención, mostraría una cuota exenta como deuda. Cada
// consumidor de computeDueSummary tiene que (1) pedir el embed de exenciones
// en su select y (2) pasarle los ciclos a computeDueSummary como 4º argumento.
describe("every workshop-due consumer takes the base-fee waiver into account", () => {
  for (const relativePath of CONSUMERS) {
    it(`${relativePath} pide las exenciones y se las pasa a computeDueSummary`, () => {
      const source = readFileSync(path.resolve(__dirname, "..", relativePath), "utf-8");
      expect(source).toMatch(/DUE_WAIVERS_(DETAIL_)?SELECT/);
      // computeDueSummary(due, items, payments, waivers): el 4º argumento existe.
      expect(source).toMatch(/computeDueSummary\([^)]*,\s*(waivers|waiverRows|\w*[wW]aiver\w*)\s*\)/);
    });
  }

  it("el dashboard (vista workshop_due_balances) trae base_waived y se lo pasa a computeDueDisplayStatus", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "lib/reports.ts"), "utf-8");
    expect(source).toMatch(/select\("due_id,[^"]*base_waived"\)/);
    expect(source).toMatch(/computeDueDisplayStatus\([\s\S]*?base_waived as boolean/);
  });

  it("classifyForPeriod, lastPaidPeriod y los consumidores de estado reciben baseWaived", () => {
    for (const relativePath of ["lib/students.ts", "app/(app)/clientes/[id]/page.tsx"]) {
      const source = readFileSync(path.resolve(__dirname, "..", relativePath), "utf-8");
      expect(source).toMatch(/computeDueDisplayStatus\([^)]*baseWaived\)/);
    }
  });

  it("registrar un pago en una cuota exenta sin saldo muestra el mensaje de la base, no un error genérico", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "app/(app)/talleres/[groupId]/actions.ts"), "utf-8");
    const fn = source.slice(source.indexOf("export async function registerDuePayment"), source.indexOf("export async function updateDuePayment"));
    expect(fn).toMatch(/P0001/);
  });
});

