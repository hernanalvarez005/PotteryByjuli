import { describe, it, expect } from "vitest";
import { validateDuplicateName, suggestDuplicateName, DUPLICATE_NAME_MAX } from "./duplicate-product";

describe("validateDuplicateName", () => {
  const source = "Taza Día de la Madre - Hojas";

  it("un nombre nuevo y distinto es válido", () => {
    expect(validateDuplicateName("Taza Día de la Madre - Rayas", source)).toBeNull();
  });
  it("vacío, sólo espacios → error (no se puede confirmar)", () => {
    expect(validateDuplicateName("", source)).toMatch(/nombre/i);
    expect(validateDuplicateName("    ", source)).toMatch(/nombre/i);
  });
  it("igual al original → error, también con espacios alrededor", () => {
    expect(validateDuplicateName(source, source)).toMatch(/distinto/i);
    expect(validateDuplicateName(`  ${source}  `, source)).toMatch(/distinto/i);
  });
  it("sólo difiere en mayúsculas → es un nombre distinto (el criterio es 'exactamente igual')", () => {
    expect(validateDuplicateName(source.toUpperCase(), source)).toBeNull();
  });
  it("demasiado largo → error", () => {
    expect(validateDuplicateName("x".repeat(DUPLICATE_NAME_MAX + 1), source)).toMatch(/largo/i);
  });
  it("la sugerencia inicial '{nombre} - copia' es válida pero distinta del original", () => {
    const s = suggestDuplicateName(`  ${source} `);
    expect(s).toBe(`${source} - copia`);
    expect(validateDuplicateName(s, source)).toBeNull();
  });
});
