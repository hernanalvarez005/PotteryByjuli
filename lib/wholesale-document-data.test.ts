import { describe, it, expect } from "vitest";
import {
  buildLiveDocumentData,
  buildSnapshotDocumentData,
  documentItemsFromRows,
  type DocumentCustomerRow,
} from "./wholesale-document-data";

const ID = "11111111-1111-4111-8111-111111111111";
const items = [
  { quantity: 2, unit_price: 100, custom_name: null, product_variants: { name: "Rosa", products: { name: "Taza" } } },
];

const fullCustomer: DocumentCustomerRow = {
  first_name: "Ana", last_name: "Gómez", company_name: "Casa Ana", cuit: "20-1-2", instagram: "@ana", website: "ana.com",
  city: "Rosario", province: "Santa Fe", address: "Calle 1", postal_code: "2000", whatsapp: "5493410000000", email: "a@a.com",
};
const nullCustomer: DocumentCustomerRow = {
  first_name: "Beto", last_name: null, company_name: null, cuit: null, instagram: null, website: null,
  city: null, province: null, address: null, postal_code: null, whatsapp: null, email: null,
};
const settings = { lead_time_min_days: 10, lead_time_max_days: 20, payment_terms: "50% seña", shipping_terms: "A coordinar" };

describe("documentItemsFromRows", () => {
  it("usa el nombre de producto/variante del catálogo", () => {
    expect(documentItemsFromRows(items)).toEqual([{ productName: "Taza", variantName: "Rosa", quantity: 2, unitPrice: 100 }]);
  });

  it("un ítem personalizado usa su custom_name (nunca queda en blanco)", () => {
    expect(documentItemsFromRows([{ quantity: 30, unit_price: 5000, custom_name: "Tazas con logo", product_variants: null }])).toEqual([
      { productName: "Tazas con logo", variantName: "", quantity: 30, unitPrice: 5000 },
    ]);
  });

  it("una variante huérfana sin nombre no rompe: queda vacía", () => {
    expect(documentItemsFromRows([{ quantity: 1, unit_price: 50, product_variants: null }])[0].productName).toBe("");
  });
});

describe("buildSnapshotDocumentData (checkout)", () => {
  const buyerSnapshot = { ...fullCustomer, first_name: "Snapshot" };
  const termsSnapshot = { min_order_amount: 200000, min_total_units: 20, lead_time_min_days: 15, lead_time_max_days: 25, payment_terms: "x", shipping_terms: "y" };

  it("es una SOLICITUD con los datos congelados, tal cual", () => {
    const doc = buildSnapshotDocumentData({ orderId: ID, humanCode: "MAY-1", createdAt: "2026-09-10T12:00:00Z", buyerSnapshot, termsSnapshot, items });
    expect(doc).toMatchObject({ kind: "request", source: "checkout_snapshot", orderId: ID, humanCode: "MAY-1" });
    expect(doc.buyer).toBe(buyerSnapshot);
    expect(doc.terms).toBe(termsSnapshot); // incluye los mínimos del checkout
  });
});

describe("buildLiveDocumentData (pedido cargado a mano)", () => {
  const build = (customer: DocumentCustomerRow, s: typeof settings | null = settings) =>
    buildLiveDocumentData({ orderId: ID, humanCode: "MAY-2", createdAt: "2026-09-25T12:00:00Z", customer, settings: s, items });

  it("es un PEDIDO (no una solicitud) armado desde el cliente y la configuración", () => {
    const doc = build(fullCustomer);
    expect(doc).toMatchObject({ kind: "order", source: "order_live", humanCode: "MAY-2" });
    expect(doc.buyer).toEqual(fullCustomer);
    expect(doc.terms).toMatchObject({ payment_terms: "50% seña", shipping_terms: "A coordinar", lead_time_min_days: 10, lead_time_max_days: 20 });
  });

  it("NO incluye los mínimos del checkout", () => {
    const doc = build(fullCustomer);
    expect(doc.terms.min_order_amount).toBeNull();
    expect(doc.terms.min_total_units).toBeNull();
  });

  it("cliente con todos los opcionales en null: los conserva como null (nunca undefined ni texto)", () => {
    const { buyer } = build(nullCustomer);
    expect(buyer.first_name).toBe("Beto");
    for (const k of ["last_name", "company_name", "cuit", "instagram", "website", "city", "province", "address", "postal_code", "whatsapp", "email"] as const) {
      expect(buyer[k]).toBeNull();
    }
  });

  it("textos en blanco (espacios) se tratan como ausentes", () => {
    const { buyer, terms } = buildLiveDocumentData({
      orderId: ID, humanCode: "MAY-3", createdAt: "x", items,
      customer: { ...nullCustomer, city: "   ", email: "" },
      settings: { ...settings, payment_terms: "  " },
    });
    expect(buyer.city).toBeNull();
    expect(buyer.email).toBeNull();
    expect(terms.payment_terms).toBeNull();
  });

  it("sin fila de configuración: condiciones vacías, no falla", () => {
    const { terms } = build(fullCustomer, null);
    expect(terms).toEqual({ min_order_amount: null, min_total_units: null, lead_time_min_days: null, lead_time_max_days: null, payment_terms: null, shipping_terms: null });
  });
});
