import { describe, it, expect } from "vitest";
import {
  priceListCodeForBusinessUnit,
  priceNotice,
  retargetPriceList,
  rowsMissingPrice,
  withListPrice,
  withManualPrice,
  withPickedVariant,
  type CatalogRowPricing,
  type PickedVariant,
} from "./order-pricing";

// Precio sugerido de /pedidos/nuevo: la unidad decide la lista; un precio
// tipeado a mano nunca se pisa en silencio.

const empty: CatalogRowPricing = { product_variant_id: "", variant_label: null, prices: null, unit_price: null, priceSource: "list" };

const taza: PickedVariant = { id: "v-taza", label: "Taza", prices: { retail: 10000, wholesale: 6000 } };
const sinMayorista: PickedVariant = { id: "v-plato", label: "Plato", prices: { retail: 8000, wholesale: null } };
const sinPrecios: PickedVariant = { id: "v-jarra", label: "Jarra", prices: { retail: null, wholesale: null } };

describe("priceListCodeForBusinessUnit", () => {
  it("Minorista → retail, Mayorista → wholesale", () => {
    expect(priceListCodeForBusinessUnit("retail")).toBe("retail");
    expect(priceListCodeForBusinessUnit("wholesale")).toBe("wholesale");
  });

  it("cualquier otra unidad, o ninguna elegida todavía, conserva la lista minorista", () => {
    for (const code of ["custom", "classes", "workshops", "fairs", "", null, undefined]) {
      expect(priceListCodeForBusinessUnit(code)).toBe("retail");
    }
  });
});

describe("elegir una variante", () => {
  it("minorista: sugiere el precio minorista", () => {
    const row = withPickedVariant(empty, taza, "retail");
    expect(row).toMatchObject({ unit_price: 10000, priceSource: "list", product_variant_id: "v-taza" });
  });

  it("mayorista: sugiere el precio mayorista (no el minorista)", () => {
    expect(withPickedVariant(empty, taza, "wholesale").unit_price).toBe(6000);
  });

  it("variantes con precios distintos por lista: cada una toma el suyo", () => {
    expect(withPickedVariant(empty, sinMayorista, "retail").unit_price).toBe(8000);
    expect(withPickedVariant(empty, taza, "retail").unit_price).toBe(10000);
    expect(withPickedVariant(empty, taza, "wholesale").unit_price).toBe(6000);
  });

  it("sin precio mayorista: queda vacío (null), nunca 0 ni el minorista", () => {
    const row = withPickedVariant(empty, sinMayorista, "wholesale");
    expect(row.unit_price).toBeNull();
    expect(priceNotice(row, "wholesale")).toEqual({ kind: "no_list_price" });
  });

  it("re-elegir una variante después de un precio manual vuelve al precio de lista", () => {
    const manual = withManualPrice(withPickedVariant(empty, taza, "retail"), 9000);
    expect(withPickedVariant(manual, taza, "retail")).toMatchObject({ unit_price: 10000, priceSource: "list" });
  });
});

describe("cambio de unidad (retargetPriceList)", () => {
  it("recalcula las filas de lista: Minorista → Mayorista y de vuelta", () => {
    const rows = [withPickedVariant(empty, taza, "retail")];
    const wholesale = retargetPriceList(rows, "wholesale");
    expect(wholesale[0].unit_price).toBe(6000);
    expect(retargetPriceList(wholesale, "retail")[0].unit_price).toBe(10000);
  });

  it("NO pisa los precios manuales", () => {
    const manual = withManualPrice(withPickedVariant(empty, taza, "retail"), 9500);
    const [after] = retargetPriceList([manual], "wholesale");
    expect(after.unit_price).toBe(9500);
    expect(after.priceSource).toBe("manual");
  });

  it("mezcla: recalcula sólo las de lista", () => {
    const auto = withPickedVariant(empty, taza, "retail");
    const manual = withManualPrice(withPickedVariant(empty, sinMayorista, "retail"), 7777);
    const [a, m] = retargetPriceList([auto, manual], "wholesale");
    expect(a.unit_price).toBe(6000);
    expect(m.unit_price).toBe(7777);
  });

  it("una variante sin precio mayorista queda vacía al pasar a Mayorista", () => {
    const [row] = retargetPriceList([withPickedVariant(empty, sinMayorista, "retail")], "wholesale");
    expect(row.unit_price).toBeNull();
  });

  it("las filas sin variante elegida no se tocan", () => {
    expect(retargetPriceList([empty], "wholesale")).toEqual([empty]);
  });
});

describe("precio manual", () => {
  it("editar el precio lo marca manual", () => {
    expect(withManualPrice(withPickedVariant(empty, taza, "wholesale"), 5500)).toMatchObject({ unit_price: 5500, priceSource: "manual" });
  });

  it("avisa cuando difiere del de la lista, y no cuando coincide", () => {
    const manual = withManualPrice(withPickedVariant(empty, taza, "wholesale"), 5500);
    expect(priceNotice(manual, "wholesale")).toEqual({ kind: "manual_differs", listPrice: 6000 });
    expect(priceNotice(withManualPrice(manual, 6000), "wholesale")).toBeNull();
  });

  it("'Usar precio de lista' vuelve a la sugerencia de la lista vigente", () => {
    const manual = withManualPrice(withPickedVariant(empty, taza, "retail"), 1);
    expect(withListPrice(manual, "wholesale")).toMatchObject({ unit_price: 6000, priceSource: "list" });
  });

  it("precio manual sobre una variante sin precio de lista: avisa que la lista no lo tiene", () => {
    const row = withManualPrice(withPickedVariant(empty, sinPrecios, "wholesale"), 4000);
    expect(priceNotice(row, "wholesale")).toEqual({ kind: "manual_differs", listPrice: null });
  });
});

describe("filas sin precio", () => {
  it("una variante elegida sin precio bloquea (nunca se descarta en silencio); una fila vacía no", () => {
    const missing = withPickedVariant(empty, sinPrecios, "retail");
    expect(rowsMissingPrice([empty, missing])).toEqual([missing]);
    expect(rowsMissingPrice([withPickedVariant(empty, taza, "retail")])).toEqual([]);
  });

  it("un precio 0 cargado a propósito NO cuenta como faltante", () => {
    expect(rowsMissingPrice([withManualPrice(withPickedVariant(empty, sinPrecios, "retail"), 0)])).toEqual([]);
  });

  it("sin variante elegida no hay aviso", () => {
    expect(priceNotice(empty, "wholesale")).toBeNull();
  });
});
