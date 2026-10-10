import { describe, it, expect } from "vitest";
import {
  addsCatalogItems,
  buildChanges,
  canModifyOrder,
  increasesCatalogQuantity,
  itemRules,
  pdfStaleness,
  previewTotals,
  type CurrentItem,
  type DraftState,
  type ModifyChange,
} from "./order-modification";
import { modifyOrderSchema } from "../schemas/orders";

const items: CurrentItem[] = [
  { id: "a", quantity: 10, unit_price: 9000, isCustom: false },
  { id: "b", quantity: 10, unit_price: 9000, isCustom: true },
];
const empty: DraftState = { quantities: {}, removed: new Set(), added: [] };

describe("canModifyOrder", () => {
  it("sólo pedidos no cancelados; nunca ventas rápidas", () => {
    for (const status of ["pending", "confirmed", "in_production", "ready", "delivered"]) {
      expect(canModifyOrder({ status, operationType: "order" })).toBe(true);
    }
    expect(canModifyOrder({ status: "cancelled", operationType: "order" })).toBe(false);
    expect(canModifyOrder({ status: "delivered", operationType: "retail_sale" })).toBe(false);
  });
});

describe("itemRules (espejo de modify_order)", () => {
  it("pending: todo permitido, catálogo o personalizado", () => {
    for (const custom of [true, false]) expect(itemRules("pending", custom)).toMatchObject({ canIncrease: true, canDecrease: true, canRemove: true, blockedReason: null });
  });

  it("confirmed / in_production / ready: reducir y quitar sólo ítems personalizados", () => {
    for (const status of ["confirmed", "in_production", "ready"]) {
      expect(itemRules(status, true)).toMatchObject({ canDecrease: true, canRemove: true });
      const catalog = itemRules(status, false);
      expect(catalog).toMatchObject({ canIncrease: true, canDecrease: false, canRemove: false });
      expect(catalog.blockedReason).toMatch(/pendiente/);
    }
  });

  it("delivered: sólo agregar; ni siquiera un personalizado se reduce o quita", () => {
    for (const custom of [true, false]) {
      expect(itemRules("delivered", custom)).toMatchObject({ canIncrease: true, canDecrease: false, canRemove: false });
    }
  });
});

describe("vista previa: total nuevo, pagos intactos, saldo recalculado", () => {
  const base = { items, discountTotal: 0, currentTotal: 180000, paid: 0 };

  it("ejemplo del pedido: 20 piezas $180.000 + 1 taza $12.000 = $192.000", () => {
    const p = previewTotals({ ...base, draft: { ...empty, added: [{ quantity: 1, unit_price: 12000 }] } });
    expect(p).toMatchObject({ subtotal: 192000, total: 192000, totalDelta: 12000 });
  });

  it("pedido parcialmente pagado: el saldo es el nuevo total menos lo cobrado", () => {
    const p = previewTotals({ ...base, paid: 100000, draft: { ...empty, added: [{ quantity: 1, unit_price: 12000 }] } });
    expect(p.balance).toBe(92000);
  });

  it("pedido totalmente pagado que pasa a tener saldo", () => {
    expect(previewTotals({ ...base, paid: 180000, draft: empty }).balance).toBe(0);
    expect(previewTotals({ ...base, paid: 180000, draft: { ...empty, added: [{ quantity: 1, unit_price: 12000 }] } }).balance).toBe(12000);
  });

  it("subir cantidad y quitar un ítem", () => {
    const p = previewTotals({ ...base, draft: { quantities: { a: 12 }, removed: new Set(["b"]), added: [] } });
    expect(p.subtotal).toBe(12 * 9000);
  });

  it("respeta el descuento del pedido y nunca devuelve saldo negativo (sobrepago)", () => {
    const p = previewTotals({ ...base, discountTotal: 20000, paid: 500000, draft: empty });
    expect(p.total).toBe(160000);
    expect(p.balance).toBe(0);
  });
});

describe("buildChanges", () => {
  it("omite los no-ops y arma quitar / cambiar cantidad / agregar", () => {
    const added: ModifyChange[] = [{ op: "add", custom_name: "Taza", quantity: 1, unit_price: 100 }];
    const draft: DraftState = { quantities: { a: 10, b: 15 }, removed: new Set(), added: [] };
    expect(buildChanges(items, draft, added)).toEqual([{ op: "set_quantity", order_item_id: "b", quantity: 15 }, ...added]);
    expect(buildChanges(items, { quantities: { a: 99 }, removed: new Set(["a"]), added: [] }, [])).toEqual([{ op: "remove", order_item_id: "a" }]);
    expect(buildChanges(items, empty, [])).toEqual([]);
  });
});

describe("¿mueve stock?", () => {
  it("agregar un ítem de catálogo sí; uno personalizado no", () => {
    expect(addsCatalogItems([{ op: "add", product_variant_id: "v", quantity: 1, unit_price: 1 }])).toBe(true);
    expect(addsCatalogItems([{ op: "add", custom_name: "x", quantity: 1, unit_price: 1 }])).toBe(false);
  });
  it("subir la cantidad de un ítem de catálogo sí; de un personalizado o reducir no", () => {
    expect(increasesCatalogQuantity(items, { ...empty, quantities: { a: 11 } })).toBe(true);
    expect(increasesCatalogQuantity(items, { ...empty, quantities: { b: 11 } })).toBe(false);
    expect(increasesCatalogQuantity(items, { ...empty, quantities: { a: 5 } })).toBe(false);
  });
});

describe("pdfStaleness", () => {
  it("desactualizado sólo si hay una modificación POSTERIOR a la generación", () => {
    expect(pdfStaleness({ pdfGeneratedAt: "2026-10-01T10:00:00Z", lastAdjustmentAt: "2026-10-02T10:00:00Z" })).toBe("stale");
    expect(pdfStaleness({ pdfGeneratedAt: "2026-10-03T10:00:00Z", lastAdjustmentAt: "2026-10-02T10:00:00Z" })).toBe("none");
    expect(pdfStaleness({ pdfGeneratedAt: "2026-10-01T10:00:00Z", lastAdjustmentAt: null })).toBe("none");
    expect(pdfStaleness({ pdfGeneratedAt: null, lastAdjustmentAt: "2026-10-02T10:00:00Z" })).toBe("none");
  });
});

describe("modifyOrderSchema", () => {
  const ok = { changes: [{ op: "add", custom_name: "Taza", quantity: 1, unit_price: 100 }], reason: "pidieron una más", consume_stock: true };
  it("acepta un cambio válido", () => expect(modifyOrderSchema.safeParse(ok).success).toBe(true));
  it("el motivo es obligatorio (también sólo espacios) y tiene tope de 300", () => {
    expect(modifyOrderSchema.safeParse({ ...ok, reason: "   " }).success).toBe(false);
    expect(modifyOrderSchema.safeParse({ ...ok, reason: "x".repeat(301) }).success).toBe(false);
  });
  it("sin cambios, cantidades no enteras o precios negativos se rechazan", () => {
    expect(modifyOrderSchema.safeParse({ ...ok, changes: [] }).success).toBe(false);
    expect(modifyOrderSchema.safeParse({ ...ok, changes: [{ op: "add", custom_name: "x", quantity: 1.5, unit_price: 1 }] }).success).toBe(false);
    expect(modifyOrderSchema.safeParse({ ...ok, changes: [{ op: "add", custom_name: "x", quantity: 1, unit_price: -1 }] }).success).toBe(false);
  });
});
