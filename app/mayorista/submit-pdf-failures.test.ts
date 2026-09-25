import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WholesalePdfStepError } from "@/lib/wholesale-pdf-store";

// Checkout mayorista: una falla del PDF NUNCA deshace ni duplica el pedido,
// y cada falla deja un log estructurado con etapa, humanCode y orderId —
// sin datos personales del comprador. Se mockean los bordes del pipeline
// (RPC, lectura con service role, render, upload, signed URL); el resto es
// el código real (acción + pipeline + logger).

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

const getWholesaleOrderForDocument = vi.fn();
const uploadWholesaleOrderPdf = vi.fn();
const createWholesalePdfSignedUrl = vi.fn();
vi.mock("@/lib/supabase/admin-server-only", () => ({
  getWholesaleOrderForDocument: (...a: unknown[]) => getWholesaleOrderForDocument(...a),
  uploadWholesaleOrderPdf: (...a: unknown[]) => uploadWholesaleOrderPdf(...a),
  createWholesalePdfSignedUrl: (...a: unknown[]) => createWholesalePdfSignedUrl(...a),
}));

const renderWholesaleOrderPdf = vi.fn();
vi.mock("@/lib/wholesale-pdf", () => ({ renderWholesaleOrderPdf: (...a: unknown[]) => renderWholesaleOrderPdf(...a) }));

const { submitWholesaleRequest } = await import("./actions");

const HUMAN_CODE = "MAY-000777";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const BUYER_EMAIL = "compradora.secreta@example.com";
const BUYER_NAME = "Gisela";
const BUYER_COMPANY = "Comercio Reservado";

function form() {
  const f = new FormData();
  f.set("items", JSON.stringify([{ product_variant_id: "22222222-2222-4222-8222-222222222222", quantity: 6 }]));
  f.set("first_name", BUYER_NAME);
  f.set("last_name", "Soto");
  f.set("company_name", BUYER_COMPANY);
  f.set("city", "Rosario");
  f.set("province", "Santa Fe");
  f.set("whatsapp", "3415551234");
  f.set("email", BUYER_EMAIL);
  f.set("client_request_id", "33333333-3333-4333-8333-333333333333");
  return f;
}

function orderForDocument() {
  return {
    ok: true as const,
    order: { orderId: ORDER_ID, humanCode: HUMAN_CODE, createdAt: "2026-09-23T22:10:10Z", buyer: { first_name: BUYER_NAME, whatsapp: "x" }, terms: {}, items: [] },
  };
}

type ConsoleSpy = { mock: { calls: unknown[][] } };
let errorSpy: ConsoleSpy;
let warnSpy: ConsoleSpy;
let infoSpy: ConsoleSpy;

type LogLine = Record<string, unknown>;
const lines = (spy: ConsoleSpy): LogLine[] =>
  spy.mock.calls
    .map((c) => c[0])
    .filter((l): l is string => typeof l === "string" && l.startsWith("{"))
    .map((l) => JSON.parse(l) as LogLine);
const failedEvents = () => lines(errorSpy).filter((l) => l.event === "wholesale_pdf_failed");

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: HUMAN_CODE, error: null });
  getWholesaleOrderForDocument.mockResolvedValue(orderForDocument());
  renderWholesaleOrderPdf.mockResolvedValue(Buffer.from("%PDF-fake"));
  uploadWholesaleOrderPdf.mockResolvedValue(`${ORDER_ID}/${HUMAN_CODE}.pdf`);
  createWholesalePdfSignedUrl.mockResolvedValue({ ok: true, url: "https://signed.example/doc.pdf" });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Todo lo que salió por consola, para verificar que no hay datos personales. */
const allOutput = () => JSON.stringify([errorSpy, warnSpy, infoSpy].map((s) => s.mock.calls));

describe("checkout mayorista — PDF", () => {
  it("pedido creado + PDF correcto: devuelve link y orderId, y loguea started → generated", async () => {
    const result = await submitWholesaleRequest({}, form());
    expect(result).toEqual({ humanCode: HUMAN_CODE, orderId: ORDER_ID, documentUrl: "https://signed.example/doc.pdf" });
    expect(lines(infoSpy).map((l) => l.event)).toEqual(["wholesale_pdf_started", "wholesale_pdf_generated"]);
    expect(failedEvents()).toHaveLength(0);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("getWholesaleOrderForDocument → not_found: el pedido sigue creado, sin link, con log load_order/not_found", async () => {
    getWholesaleOrderForDocument.mockResolvedValue({ ok: false, reason: "not_found" });
    const result = await submitWholesaleRequest({}, form());
    expect(result).toEqual({ humanCode: HUMAN_CODE, orderId: undefined, documentUrl: null });
    expect(failedEvents()).toEqual([expect.objectContaining({ event: "wholesale_pdf_failed", step: "load_order", reason: "not_found", humanCode: HUMAN_CODE, source: "checkout" })]);
    expect(renderWholesaleOrderPdf).not.toHaveBeenCalled();
  });

  it("snapshot incompleto: distingue el motivo y conserva el orderId conocido", async () => {
    getWholesaleOrderForDocument.mockResolvedValue({ ok: false, reason: "snapshot_incomplete", orderId: ORDER_ID, humanCode: HUMAN_CODE });
    const result = await submitWholesaleRequest({}, form());
    expect(result.orderId).toBe(ORDER_ID);
    expect(result.documentUrl).toBeNull();
    expect(failedEvents()[0]).toMatchObject({ step: "load_order", reason: "snapshot_incomplete", orderId: ORDER_ID });
  });

  it("error de consulta: se loguea con su detalle, no queda mudo", async () => {
    getWholesaleOrderForDocument.mockResolvedValue({ ok: false, reason: "query_error", detail: "57014: statement timeout" });
    const result = await submitWholesaleRequest({}, form());
    expect(result.humanCode).toBe(HUMAN_CODE);
    expect(failedEvents()[0]).toMatchObject({ step: "load_order", reason: "query_error", errorMessage: "57014: statement timeout" });
  });

  it("la lectura lanza (p. ej. falta la service role key): pedido creado, log load_order", async () => {
    getWholesaleOrderForDocument.mockRejectedValue(new Error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno."));
    const result = await submitWholesaleRequest({}, form());
    expect(result).toMatchObject({ humanCode: HUMAN_CODE, documentUrl: null });
    expect(failedEvents()[0]).toMatchObject({ step: "load_order", humanCode: HUMAN_CODE });
    expect(String(failedEvents()[0].errorMessage)).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("falla el render: pedido creado, orderId disponible, log step=render", async () => {
    renderWholesaleOrderPdf.mockRejectedValue(new Error("layout exploded"));
    const result = await submitWholesaleRequest({}, form());
    expect(result).toEqual({ humanCode: HUMAN_CODE, orderId: ORDER_ID, documentUrl: null });
    expect(failedEvents()[0]).toMatchObject({ step: "render", humanCode: HUMAN_CODE, orderId: ORDER_ID, errorMessage: "layout exploded" });
    expect(uploadWholesaleOrderPdf).not.toHaveBeenCalled();
  });

  it("falla el upload: log step=upload", async () => {
    uploadWholesaleOrderPdf.mockRejectedValue(new WholesalePdfStepError("upload", "No se pudo subir el PDF: Bucket not found"));
    const result = await submitWholesaleRequest({}, form());
    expect(result).toEqual({ humanCode: HUMAN_CODE, orderId: ORDER_ID, documentUrl: null });
    expect(failedEvents()[0]).toMatchObject({ step: "upload", orderId: ORDER_ID });
  });

  it("falla el registro del adjunto (el archivo sí se subió): log step=attachment_insert", async () => {
    uploadWholesaleOrderPdf.mockRejectedValue(new WholesalePdfStepError("attachment_insert", "El PDF se subió pero no se pudo registrar", "23505"));
    await submitWholesaleRequest({}, form());
    expect(failedEvents()[0]).toMatchObject({ step: "attachment_insert", errorCode: "23505" });
  });

  it("signed URL falla: el PDF SÍ existe → 'link_unavailable' (warn), NO 'failed'; sin link", async () => {
    createWholesalePdfSignedUrl.mockResolvedValue({ ok: false, error: "Object not found" });
    const result = await submitWholesaleRequest({}, form());
    expect(result).toEqual({ humanCode: HUMAN_CODE, orderId: ORDER_ID, documentUrl: null });
    expect(failedEvents()).toHaveLength(0);
    expect(lines(warnSpy)).toEqual([expect.objectContaining({ event: "wholesale_pdf_link_unavailable", step: "signed_url", humanCode: HUMAN_CODE, orderId: ORDER_ID, errorMessage: "Object not found" })]);
    expect(lines(infoSpy).map((l) => l.event)).toContain("wholesale_pdf_generated");
  });

  it("signed URL lanza: también 'link_unavailable'", async () => {
    createWholesalePdfSignedUrl.mockRejectedValue(new Error("network"));
    const result = await submitWholesaleRequest({}, form());
    expect(result.documentUrl).toBeNull();
    expect(lines(warnSpy)[0]).toMatchObject({ event: "wholesale_pdf_link_unavailable" });
    expect(failedEvents()).toHaveLength(0);
  });

  it("en ninguna falla se reintenta ni se vuelve a crear el pedido (1 RPC, 1 render, 1 upload)", async () => {
    renderWholesaleOrderPdf.mockRejectedValue(new Error("boom"));
    await submitWholesaleRequest({}, form());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(renderWholesaleOrderPdf).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: HUMAN_CODE, error: null });
    getWholesaleOrderForDocument.mockResolvedValue(orderForDocument());
    renderWholesaleOrderPdf.mockResolvedValue(Buffer.from("%PDF"));
    uploadWholesaleOrderPdf.mockRejectedValue(new Error("boom"));
    await submitWholesaleRequest({}, form());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(uploadWholesaleOrderPdf).toHaveBeenCalledTimes(1);
  });

  it("los logs NUNCA incluyen datos del comprador (nombre, email, comercio)", async () => {
    getWholesaleOrderForDocument.mockResolvedValue({ ok: false, reason: "query_error", detail: "boom" });
    await submitWholesaleRequest({}, form());
    renderWholesaleOrderPdf.mockRejectedValue(new Error("boom"));
    getWholesaleOrderForDocument.mockResolvedValue(orderForDocument());
    await submitWholesaleRequest({}, form());
    const out = allOutput();
    expect(out).not.toContain(BUYER_EMAIL);
    expect(out).not.toContain(BUYER_COMPANY);
    expect(out).not.toContain(BUYER_NAME);
    expect(out).toContain(HUMAN_CODE);
  });

  it("si el RPC falla no se intenta ningún PDF", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "El pedido no alcanza el mínimo." } });
    const result = await submitWholesaleRequest({}, form());
    expect(result.error).toBe("El pedido no alcanza el mínimo.");
    expect(getWholesaleOrderForDocument).not.toHaveBeenCalled();
  });
});
