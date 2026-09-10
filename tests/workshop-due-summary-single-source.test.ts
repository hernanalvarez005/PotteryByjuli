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
