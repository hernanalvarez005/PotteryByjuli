import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderWholesaleOrderPdf } from "./wholesale-pdf";
import { renderOrderPdf } from "./order-pdf";

// React PDF embebe la imagen COMPLETA. Con el logo original de 2000×2000
// (~1,29 MB) cada PDF pesaba ~1,3 MB; con el asset dedicado de 256 px pesa
// ~44 KB. Este test evita volver a apuntar los PDFs al logo grande.

const BRAND_DIR = path.join(process.cwd(), "public/brand");

function pngSize(file: string) {
  const d = readFileSync(path.join(BRAND_DIR, file));
  return { width: d.readUInt32BE(16), height: d.readUInt32BE(20), bytes: d.length };
}

describe("logo dedicado para los PDFs", () => {
  it("el asset de PDF es chico (≤ 512 px, ≤ 150 KB) y el original del sitio se conserva", () => {
    const pdfLogo = pngSize("pottery-logo-pdf.png");
    expect(pdfLogo.width).toBeLessThanOrEqual(512);
    expect(pdfLogo.height).toBeLessThanOrEqual(512);
    expect(pdfLogo.bytes).toBeLessThan(150 * 1024);
    // Se dibuja a 48×48 pt: 256 px alcanzan de sobra para impresión.
    expect(pdfLogo.width).toBeGreaterThanOrEqual(192);

    // El original sigue existiendo (lo usan los layouts con next/image).
    expect(pngSize("pottery-logo.png").width).toBe(2000);
  });

  it("el PDF mayorista pesa < 150 KB (antes ~1,3 MB)", async () => {
    const bytes = await renderWholesaleOrderPdf({
      humanCode: "MAY-000001",
      createdAt: new Date("2026-09-10T12:00:00Z"),
      buyer: { first_name: "A", last_name: null, company_name: null, cuit: null, instagram: null, website: null, city: null, province: null, address: null, postal_code: null, whatsapp: "1", email: null },
      items: [{ productName: "Taza", variantName: "Rosa", quantity: 1, unitPrice: 100 }],
      terms: { min_order_amount: null, min_total_units: null, lead_time_min_days: null, lead_time_max_days: null, payment_terms: null, shipping_terms: null },
    });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeLessThan(150 * 1024);
  });

  it("el resumen PDF de pedido también pesa < 150 KB", async () => {
    const bytes = await renderOrderPdf({
      humanCode: "PED-000001",
      createdAt: new Date("2026-09-10T12:00:00Z"),
      customerName: "Cliente",
      items: [{ label: "Taza", note: null, quantity: 1, unitPrice: 100 }],
      payments: [],
      estimatedDate: null,
      notes: null,
    });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeLessThan(150 * 1024);
  });
});
