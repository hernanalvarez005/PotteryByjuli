import { describe, it, expect } from "vitest";
import { maskCurrency } from "./privacy-mode";
import { formatCurrency } from "./format";

// maskCurrency es el "formateador compartido" del modo privado (Bloque
// 8) — el mismo que usan los 3 KPIs de importe y los 3 gráficos del
// dashboard, para que enmascarar nunca dependa de un formateador propio
// por componente (ese es el riesgo real que el diseño marcó: un chart
// con su propio Intl.NumberFormat inline no se entera de este modo).

describe("maskCurrency", () => {
  it("returns the real formatted amount when privacy mode is off", () => {
    expect(maskCurrency(45000, false)).toBe(formatCurrency(45000));
  });

  it("never reveals the real number when privacy mode is on, regardless of amount", () => {
    expect(maskCurrency(45000, true)).toBe("$ ••••••");
    expect(maskCurrency(0, true)).toBe("$ ••••••");
    expect(maskCurrency(-500, true)).toBe("$ ••••••");
    expect(maskCurrency(1234567.89, true)).toBe("$ ••••••");
  });

  it("the masked string never contains any digit from the real amount", () => {
    const masked = maskCurrency(918273, true);
    expect(masked).not.toMatch(/\d/);
  });
});
