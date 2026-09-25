import { describe, it, expect, vi, afterEach } from "vitest";
import { logWholesalePdf } from "./wholesale-pdf-log";

afterEach(() => vi.restoreAllMocks());

describe("logWholesalePdf", () => {
  it("failed → console.error, una línea JSON con event, step, humanCode y orderId", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logWholesalePdf("wholesale_pdf_failed", { humanCode: "MAY-000024", orderId: "abc", step: "render", source: "checkout", elapsedMs: 42, error: new Error("boom") });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0] as string;
    expect(line.includes("\n")).toBe(false);
    expect(JSON.parse(line)).toMatchObject({
      event: "wholesale_pdf_failed", step: "render", humanCode: "MAY-000024", orderId: "abc", elapsedMs: 42, errorName: "Error", errorMessage: "boom",
    });
  });

  it("link_unavailable → warn; started/generated → info (niveles distintos)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    logWholesalePdf("wholesale_pdf_link_unavailable", { humanCode: "M", step: "signed_url" });
    logWholesalePdf("wholesale_pdf_started", { humanCode: "M" });
    logWholesalePdf("wholesale_pdf_generated", { humanCode: "M" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(2);
    expect(err).not.toHaveBeenCalled();
  });

  it("extrae code de errores tipo Supabase y acepta strings", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logWholesalePdf("wholesale_pdf_failed", { humanCode: "M", step: "attachment_insert", error: { message: "dup", code: "23505" } });
    logWholesalePdf("wholesale_pdf_failed", { humanCode: "M", step: "load_order", error: "detalle en texto" });
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({ errorMessage: "dup", errorCode: "23505" });
    expect(JSON.parse(spy.mock.calls[1][0] as string)).toMatchObject({ errorMessage: "detalle en texto" });
  });

  it("trunca mensajes larguísimos", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logWholesalePdf("wholesale_pdf_failed", { humanCode: "M", step: "render", error: new Error("x".repeat(5000)) });
    expect(String(JSON.parse(spy.mock.calls[0][0] as string).errorMessage).length).toBeLessThanOrEqual(300);
  });
});
