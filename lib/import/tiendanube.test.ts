import { describe, it, expect } from "vitest";
import {
  parseArsAmount,
  parseStockQuantity,
  isLegacyWorkshopDeposit,
  mapTiendaNubeCategory,
  groupTiendaNubeRows,
  buildTiendaNubePlan,
  parseTiendaNubeCsv,
  stripHtml,
  type TiendaNubeRow,
} from "./tiendanube";

function row(overrides: Partial<TiendaNubeRow>): TiendaNubeRow {
  return {
    identifier: "",
    name: "",
    categories: "",
    property1Value: "",
    price: "",
    promoPrice: "",
    stock: "0",
    sku: "",
    showInStore: "SI",
    description: "",
    cost: "",
    ...overrides,
  };
}

describe("parseArsAmount", () => {
  it("reads comma-thousands, dot-decimal as whole pesos", () => {
    expect(parseArsAmount("27,500.00")).toBe(27500);
    expect(parseArsAmount("17,800.00")).toBe(17800);
  });

  it("never treats the comma as a decimal separator", () => {
    // A naive parse would read this as 17.8 — must not happen.
    expect(parseArsAmount("17,800.00")).not.toBe(17.8);
  });

  it("returns null for a blank value", () => {
    expect(parseArsAmount("")).toBeNull();
    expect(parseArsAmount("   ")).toBeNull();
  });
});

describe("parseStockQuantity", () => {
  it("parses a whole number", () => {
    expect(parseStockQuantity("5")).toBe(5);
  });

  it("treats a blank value as zero, not a missing variant", () => {
    expect(parseStockQuantity("")).toBe(0);
  });
});

describe("isLegacyWorkshopDeposit", () => {
  it("flags the real legacy seña products", () => {
    expect(isLegacyWorkshopDeposit("WORKSHOP CERAMICA 18/4 SEÑA")).toBe(true);
    expect(isLegacyWorkshopDeposit("Taller MARTES 15 a 17hs. (SEÑA)")).toBe(true);
  });

  it("never flags a normal product", () => {
    expect(isLegacyWorkshopDeposit("Taza alta")).toBe(false);
  });
});

describe("mapTiendaNubeCategory", () => {
  it("maps a VAJILLA subcategory to vajilla", () => {
    expect(mapTiendaNubeCategory("VAJILLA > Tazas").categoryCode).toBe("tazas");
    expect(mapTiendaNubeCategory("VAJILLA > Submarino").categoryCode).toBe("vajilla");
  });

  it("flags MADERA as a new category, not an existing one", () => {
    const result = mapTiendaNubeCategory("MADERA");
    expect(result.categoryCode).toBe("madera");
    expect(result.isNew).toBe(true);
  });

  it("takes only the first token when a product has several categories", () => {
    expect(mapTiendaNubeCategory("NAVIDAD, VELAS").categoryCode).toBe("decoracion");
  });

  it("leaves a blank category unmapped instead of guessing", () => {
    expect(mapTiendaNubeCategory("").categoryCode).toBeNull();
  });
});

describe("groupTiendaNubeRows", () => {
  it("carries the identifier forward across blank-id variant rows", () => {
    const rows = [
      row({ identifier: "taza-alta", name: "Taza alta", property1Value: "Bicolor" }),
      row({ property1Value: "Escamas" }),
      row({ property1Value: "Puntitos" }),
    ];
    const groups = groupTiendaNubeRows(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it("starts a new group whenever a non-blank identifier appears", () => {
    const rows = [
      row({ identifier: "a", name: "A" }),
      row({ identifier: "b", name: "B" }),
    ];
    expect(groupTiendaNubeRows(rows)).toHaveLength(2);
  });
});

describe("stripHtml", () => {
  it("removes tags and decodes the entities this export actually uses", () => {
    expect(stripHtml("<p>Una taza de cer&aacute;mica.</p>")).toBe("Una taza de cerámica.");
  });
});

describe("buildTiendaNubePlan", () => {
  it("groups one product + N variants, never N products", () => {
    const rows = [
      row({ identifier: "taza-alta", name: "Taza alta", categories: "VAJILLA > Tazas", price: "10,000.00", stock: "2", property1Value: "Bicolor" }),
      row({ property1Value: "Escamas", stock: "3" }),
      row({ property1Value: "Puntitos", stock: "0" }),
    ];
    const plan = buildTiendaNubePlan(rows);
    expect(plan.products).toHaveLength(1);
    expect(plan.products[0].variants).toHaveLength(3);
    expect(plan.totals.variantsTotal).toBe(3);
    expect(plan.totals.stockTotal).toBe(5);
  });

  it("keeps a stock-zero variant instead of dropping it", () => {
    const rows = [row({ identifier: "mate1", name: "Mate", stock: "0" })];
    const plan = buildTiendaNubePlan(rows);
    expect(plan.products[0].variants).toEqual([{ name: "Único", stock: 0 }]);
  });

  it("excludes legacy seña rows from the physical catalog, without dropping them from the report", () => {
    const rows = [
      row({ identifier: "taza-alta", name: "Taza alta" }),
      row({ identifier: "workshop-x-sena", name: "WORKSHOP X SEÑA" }),
    ];
    const plan = buildTiendaNubePlan(rows);
    expect(plan.products).toHaveLength(1);
    expect(plan.legacyExcluded).toEqual([{ externalId: "workshop-x-sena", name: "WORKSHOP X SEÑA" }]);
    expect(plan.totals.legacyExcluded).toBe(1);
  });

  it("never silently applies a promotional price as the base price", () => {
    const rows = [row({ identifier: "taza-mama", name: "Taza Mamá", price: "17,800.00", promoPrice: "16,000.00" })];
    const plan = buildTiendaNubePlan(rows);
    expect(plan.products[0].retailPrice).toBe(17800);
    expect(plan.products[0].promoPrice).toBe(16000);
    expect(plan.warnings.some((w) => w.message.includes("promocional"))).toBe(true);
  });

  it("marks a product hidden in Tienda Nube as not visible, but still imports it", () => {
    const rows = [row({ identifier: "oculto", name: "Producto oculto", showInStore: "NO" })];
    const plan = buildTiendaNubePlan(rows);
    expect(plan.products[0].isVisible).toBe(false);
    expect(plan.totals.hidden).toBe(1);
  });

  it("merges a duplicated variant name instead of colliding on insert", () => {
    const rows = [
      row({ identifier: "p1", name: "P1", property1Value: "Rojo", stock: "1" }),
      row({ property1Value: "Rojo", stock: "2" }),
    ];
    const plan = buildTiendaNubePlan(rows);
    expect(plan.products[0].variants).toEqual([{ name: "Rojo", stock: 3 }]);
    expect(plan.warnings.some((w) => w.message.includes("duplicada"))).toBe(true);
  });
});

describe("parseTiendaNubeCsv end-to-end", () => {
  it("parses a real-shaped export fragment into the expected plan totals", () => {
    const csv = [
      "Identificador de URL;Nombre;Categorías;Nombre de propiedad 1;Valor de propiedad 1;Nombre de propiedad 2;Valor de propiedad 2;Nombre de propiedad 3;Valor de propiedad 3;Precio;Precio promocional;Peso (kg);Alto (cm);Ancho (cm);Profundidad (cm);Stock;SKU;Código de barras;Mostrar en tienda;Envío sin cargo;Descripción;Tags;Título para SEO;Descripción para SEO;Marca;Producto Físico;MPN;Sexo;Rango de edad;Costo;Visibilidad",
      'taza-alta;Taza alta;VAJILLA > Tazas;Diseño;Bicolor;;;;;10,000.00;;;;;;2;;;SI;NO;"<p>Taza</p>";;;;;SI;;;;;Visible',
      ';;;;Escamas;;;;;;;;;;;3;;;;;;;;;;;;;;;',
      'workshop-sena;WORKSHOP X SEÑA;WORKSHOP;;;;;;;5,000.00;;;;;;0;;;NO;NO;;;;;;SI;;;;;Oculto',
    ].join("\n");

    const rows = parseTiendaNubeCsv(csv);
    expect(rows).toHaveLength(3);

    const plan = buildTiendaNubePlan(rows);
    expect(plan.totals.productsDetected).toBe(2);
    expect(plan.totals.physicalProducts).toBe(1);
    expect(plan.totals.legacyExcluded).toBe(1);
    expect(plan.products[0].variants).toHaveLength(2);
    expect(plan.products[0].variants[0].name).toBe("Bicolor");
  });
});
