import { describe, it, expect } from "vitest";
import { renderWholesaleOrderPdf, type WholesaleOrderPdfInput } from "./wholesale-pdf";

// pdf-parse extracts real text from the rendered PDF bytes — a
// buffer-non-empty check alone wouldn't catch a mislabeled or blank
// document (sección 33 del brief: el PDF debe contener realmente el
// código, comprador, productos, total y el estado "pendiente de
// confirmación").
import { PDFParse } from "pdf-parse";

async function extractText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

const baseInput: WholesaleOrderPdfInput = {
  humanCode: "MAY-000127",
  createdAt: new Date("2026-09-10T12:00:00Z"),
  buyer: {
    first_name: "Juan",
    last_name: "Pérez",
    company_name: "Casa Magnolia",
    cuit: "20-12345678-9",
    instagram: null,
    website: null,
    city: "Rosario",
    province: "Santa Fe",
    address: null,
    postal_code: null,
    whatsapp: "5493411234567",
    email: "juan@casamagnolia.com",
  },
  items: [
    { productName: "Taza Clásica", variantName: "Rosa", quantity: 8, unitPrice: 12500 },
    { productName: "Mate Bombé", variantName: "Crudo", quantity: 6, unitPrice: 10000 },
  ],
  terms: {
    min_order_amount: 200000,
    min_total_units: 20,
    lead_time_min_days: 15,
    lead_time_max_days: 25,
    payment_terms: "50% de seña, 50% antes de la entrega.",
    shipping_terms: "A coordinar según destino.",
  },
};

describe("renderWholesaleOrderPdf", () => {
  it("produces a real PDF buffer", async () => {
    const buffer = await renderWholesaleOrderPdf(baseInput);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("contains the order code, buyer, products, total, and the pending-confirmation label", async () => {
    const buffer = await renderWholesaleOrderPdf(baseInput);
    const text = await extractText(buffer);

    expect(text).toContain("MAY-000127");
    expect(text).toContain("Juan Pérez");
    expect(text).toContain("Casa Magnolia");
    expect(text).toContain("Taza Clásica");
    expect(text).toContain("Mate Bombé");
    expect(text).toContain("SOLICITUD PENDIENTE DE CONFIRMACIÓN");
    // 8*12500 + 6*10000 = 160000
    expect(text).toContain("160.000");
  });

  it("omits optional buyer fields that have no value, never printing an empty line", async () => {
    const buffer = await renderWholesaleOrderPdf(baseInput);
    const text = await extractText(buffer);
    expect(text).not.toContain("Instagram");
    expect(text).not.toContain("Código postal");
  });

  it("includes optional buyer fields when present", async () => {
    const input: WholesaleOrderPdfInput = {
      ...baseInput,
      buyer: { ...baseInput.buyer, instagram: "@casamagnolia", postal_code: "S2000" },
    };
    const buffer = await renderWholesaleOrderPdf(input);
    const text = await extractText(buffer);
    expect(text).toContain("@casamagnolia");
    expect(text).toContain("S2000");
  });

  it("is 100% historical: two calls with different terms/prices never leak the wrong document's data into each other", async () => {
    // Regression coverage for the explicit brief requirement: the PDF must
    // represent exactly what the buyer saw at request time, never today's
    // live price/conditions. Since renderWholesaleOrderPdf takes every
    // value by parameter and never queries `customers`/`wholesale_settings`
    // /current prices itself, calling it again with a "later, changed"
    // input must not affect an already-rendered "original" document.
    const originalInput: WholesaleOrderPdfInput = {
      ...baseInput,
      items: [{ productName: "Taza Clásica", variantName: "Rosa", quantity: 10, unitPrice: 15000 }],
      terms: { ...baseInput.terms, payment_terms: "Condiciones originales" },
    };
    const changedLaterInput: WholesaleOrderPdfInput = {
      ...baseInput,
      humanCode: "MAY-000128",
      items: [{ productName: "Taza Clásica", variantName: "Rosa", quantity: 10, unitPrice: 18000 }],
      terms: { ...baseInput.terms, payment_terms: "Condiciones nuevas" },
    };

    const originalBuffer = await renderWholesaleOrderPdf(originalInput);
    // Simulate time passing / prices+conditions changing elsewhere before a
    // second document (a different order) gets rendered.
    await renderWholesaleOrderPdf(changedLaterInput);

    const originalText = await extractText(originalBuffer);
    expect(originalText).toContain("150.000"); // 10 * 15000, the original price
    expect(originalText).toContain("Condiciones originales");
    expect(originalText).not.toContain("180.000"); // 10 * 18000, the later price — must never leak in
    expect(originalText).not.toContain("Condiciones nuevas");
  });
});
