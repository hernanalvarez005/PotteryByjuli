import { describe, it, expect } from "vitest";
import { getWholesaleDocumentState, WHOLESALE_DOCUMENT_COPY } from "./wholesale-document-state";

describe("getWholesaleDocumentState", () => {
  it("pedido web con PDF → pdf_available (Ver PDF + Regenerar PDF)", () => {
    expect(getWholesaleDocumentState({ hasPdf: true, checkoutOrigin: true })).toBe("pdf_available");
  });
  it("pedido web sin PDF → pdf_missing (No se generó el PDF + Generar PDF)", () => {
    expect(getWholesaleDocumentState({ hasPdf: false, checkoutOrigin: true })).toBe("pdf_missing");
  });
  it("pedido manual mayorista sin PDF → not_from_checkout, NUNCA 'falló'", () => {
    expect(getWholesaleDocumentState({ hasPdf: false, checkoutOrigin: false })).toBe("not_from_checkout");
    expect(WHOLESALE_DOCUMENT_COPY.not_from_checkout).toBe("Todavía no se generó el PDF de este pedido.");
    expect(WHOLESALE_DOCUMENT_COPY.not_from_checkout.toLowerCase()).not.toContain("falló");
    expect(WHOLESALE_DOCUMENT_COPY.pdf_missing.toLowerCase()).not.toContain("falló");
  });
  it("un adjunto existente siempre se muestra, venga de donde venga", () => {
    expect(getWholesaleDocumentState({ hasPdf: true, checkoutOrigin: false })).toBe("pdf_available");
  });
});
