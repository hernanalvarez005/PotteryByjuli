import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadWholesaleDocumentData,
  loadWholesaleOrderForDocument,
  storeWholesaleOrderPdf,
  wholesalePdfStoragePath,
  WholesalePdfStepError,
} from "./wholesale-pdf-store";

// Cliente falso mínimo: registra qué se llamó y devuelve lo configurado.
// Sirve para probar la lógica de "actualizar si existe, insertar si no" que
// tiene que funcionar IGUAL con o sin el índice único parcial de la
// migración 20260925120000 (estado intermedio: código nuevo, migración
// todavía sin aplicar).

const ORDER = "11111111-1111-4111-8111-111111111111";
const CODE = "MAY-000024";

function fakeClient(opts: {
  uploadError?: { message: string } | null;
  updateResults?: { data: { id: string }[] | null; error: { message: string; code?: string } | null }[];
  insertError?: { message: string; code?: string } | null;
}) {
  const calls: string[] = [];
  const updates = [...(opts.updateResults ?? [{ data: [], error: null }])];
  const client = {
    storage: {
      from: () => ({
        upload: async (path: string, _b: unknown, o: { upsert?: boolean }) => {
          calls.push(`upload:${path}:upsert=${o.upsert}`);
          return { error: opts.uploadError ?? null };
        },
      }),
    },
    from: () => ({
      update: (v: { storage_path: string }) => {
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.select = async () => {
          calls.push(`update:${v.storage_path}`);
          return updates.length > 1 ? updates.shift()! : updates[0];
        };
        return chain;
      },
      insert: async (row: Record<string, unknown>) => {
        calls.push(`insert:${row.kind}:${row.uploaded_by}`);
        return { error: opts.insertError ?? null };
      },
    }),
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("storeWholesaleOrderPdf", () => {
  const params = { orderId: ORDER, humanCode: CODE, pdfBytes: Buffer.from("%PDF") };

  it("sube SIEMPRE con upsert:true a la ruta determinística {orderId}/{humanCode}.pdf", async () => {
    const { client, calls } = fakeClient({});
    const path = await storeWholesaleOrderPdf(client, params);
    expect(path).toBe(wholesalePdfStoragePath(ORDER, CODE));
    expect(path).toBe(`${ORDER}/${CODE}.pdf`);
    expect(calls[0]).toBe(`upload:${ORDER}/${CODE}.pdf:upsert=true`);
  });

  it("sin fila previa: inserta una (con uploaded_by del usuario cuando lo hay)", async () => {
    const { client, calls } = fakeClient({ updateResults: [{ data: [], error: null }] });
    await storeWholesaleOrderPdf(client, { ...params, uploadedBy: "user-1" });
    expect(calls).toContain("insert:wholesale_request_pdf:user-1");
  });

  it("con fila previa: la ACTUALIZA y no inserta otra (funciona aunque no exista el índice único)", async () => {
    const { client, calls } = fakeClient({ updateResults: [{ data: [{ id: "a" }], error: null }] });
    await storeWholesaleOrderPdf(client, params);
    expect(calls.some((c) => c.startsWith("insert:"))).toBe(false);
  });

  it("repetirlo N veces con fila existente nunca inserta", async () => {
    const { client, calls } = fakeClient({ updateResults: [{ data: [{ id: "a" }], error: null }] });
    for (let i = 0; i < 4; i++) await storeWholesaleOrderPdf(client, params);
    expect(calls.filter((c) => c.startsWith("insert:"))).toHaveLength(0);
    expect(calls.filter((c) => c.startsWith("upload:"))).toHaveLength(4);
  });

  it("carrera: el insert choca con el índice único (23505) → reusa la fila que ganó", async () => {
    const { client, calls } = fakeClient({
      updateResults: [
        { data: [], error: null },
        { data: [{ id: "winner" }], error: null },
      ],
      insertError: { message: "duplicate key", code: "23505" },
    });
    await expect(storeWholesaleOrderPdf(client, params)).resolves.toBe(`${ORDER}/${CODE}.pdf`);
    expect(calls.filter((c) => c.startsWith("update:"))).toHaveLength(2);
  });

  it("falla el upload → WholesalePdfStepError etapa 'upload' y no toca la tabla", async () => {
    const { client, calls } = fakeClient({ uploadError: { message: "Bucket not found" } });
    const err = await storeWholesaleOrderPdf(client, params).catch((e) => e);
    expect(err).toBeInstanceOf(WholesalePdfStepError);
    expect(err.step).toBe("upload");
    expect(calls.some((c) => c.startsWith("insert:") || c.startsWith("update:"))).toBe(false);
  });

  it("falla el insert → etapa 'attachment_insert' con el código de Postgres", async () => {
    const { client } = fakeClient({ insertError: { message: "boom", code: "42501" } });
    const err = await storeWholesaleOrderPdf(client, params).catch((e) => e);
    expect(err).toMatchObject({ step: "attachment_insert", code: "42501" });
  });

  it("falla el update de la referencia → etapa 'attachment_insert'", async () => {
    const { client } = fakeClient({ updateResults: [{ data: null, error: { message: "rls", code: "42501" } }] });
    await expect(storeWholesaleOrderPdf(client, params)).rejects.toMatchObject({ step: "attachment_insert" });
  });
});

function loaderClient(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) b[m] = () => b;
  b.maybeSingle = async () => result;
  return { from: vi.fn(() => b) } as unknown as SupabaseClient;
}

describe("loadWholesaleOrderForDocument — resultado explícito, nunca un null mudo", () => {
  it("pedido inexistente → not_found", async () => {
    expect(await loadWholesaleOrderForDocument(loaderClient({ data: null, error: null }), { humanCode: CODE })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("error de consulta → query_error con código y mensaje", async () => {
    const r = await loadWholesaleOrderForDocument(loaderClient({ data: null, error: { code: "57014", message: "timeout" } }), { orderId: ORDER });
    expect(r).toEqual({ ok: false, reason: "query_error", detail: "57014: timeout" });
  });

  it("existe pero sin snapshots (pedido manual) → snapshot_incomplete con su id y código", async () => {
    const r = await loadWholesaleOrderForDocument(
      loaderClient({ data: { id: ORDER, human_code: CODE, created_at: "x", wholesale_buyer_snapshot: null, wholesale_terms_snapshot: null, order_items: [] }, error: null }),
      { orderId: ORDER }
    );
    expect(r).toEqual({ ok: false, reason: "snapshot_incomplete", orderId: ORDER, humanCode: CODE });
  });

  it("snapshot de comprador presente pero sin condiciones → también incompleto", async () => {
    const r = await loadWholesaleOrderForDocument(
      loaderClient({ data: { id: ORDER, human_code: CODE, created_at: "x", wholesale_buyer_snapshot: { first_name: "A" }, wholesale_terms_snapshot: null, order_items: [] }, error: null }),
      { humanCode: CODE }
    );
    expect(r).toMatchObject({ ok: false, reason: "snapshot_incomplete" });
  });

  it("pedido completo → ok, con items tolerantes a variante huérfana", async () => {
    const r = await loadWholesaleOrderForDocument(
      loaderClient({
        data: {
          id: ORDER, human_code: CODE, created_at: "2026-09-23T22:10:10Z",
          wholesale_buyer_snapshot: { first_name: "A", whatsapp: "1" },
          wholesale_terms_snapshot: { payment_terms: "x" },
          order_items: [
            { quantity: 2, unit_price: 100, product_variants: { name: "Rosa", products: { name: "Taza" } } },
            { quantity: 1, unit_price: 50, product_variants: null },
          ],
        },
        error: null,
      }),
      { humanCode: CODE }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order.humanCode).toBe(CODE);
      expect(r.order.items).toEqual([
        { productName: "Taza", variantName: "Rosa", quantity: 2, unitPrice: 100 },
        { productName: "", variantName: "", quantity: 1, unitPrice: 50 },
      ]);
    }
  });
});


// Cliente falso de DOS tablas: `orders` (select/eq/maybeSingle) y
// `wholesale_settings` (select/limit/maybeSingle).
function documentClient(order: { data: unknown; error?: { code?: string; message: string } | null }, settings: { data: unknown; error?: { code?: string; message: string } | null } = { data: null }) {
  const chain = (result: { data: unknown; error?: unknown }) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: result.data, error: result.error ?? null });
    return b;
  };
  return {
    from: vi.fn((table: string) => (table === "orders" ? chain(order) : chain(settings))),
  } as unknown as SupabaseClient;
}

const CUSTOMER = {
  first_name: "Ana", last_name: "Gómez", company_name: "Casa Ana", cuit: null, instagram: null, website: null,
  city: "Rosario", province: "Santa Fe", address: null, postal_code: null, whatsapp: "5493410000000", email: null,
};
const ITEMS = [{ quantity: 2, unit_price: 100, custom_name: null, product_variants: { name: "Rosa", products: { name: "Taza" } } }];
const orderRow = (over: Record<string, unknown> = {}) => ({
  id: ORDER, human_code: CODE, created_at: "2026-09-25T12:00:00Z",
  wholesale_buyer_snapshot: null, wholesale_terms_snapshot: null,
  business_units: { code: "wholesale" }, customers: CUSTOMER, order_items: ITEMS,
  ...over,
});
const SETTINGS = { lead_time_min_days: 10, lead_time_max_days: 20, payment_terms: "50% seña", shipping_terms: "A coordinar" };

describe("loadWholesaleDocumentData — un camino, dos orígenes", () => {
  it("pedido del CHECKOUT (ambos snapshots) → solicitud con los datos congelados, sin mirar cliente ni configuración", async () => {
    const snapshotBuyer = { ...CUSTOMER, first_name: "Congelado" };
    const snapshotTerms = { min_order_amount: 1, min_total_units: 2, lead_time_min_days: 3, lead_time_max_days: 4, payment_terms: "orig", shipping_terms: "orig" };
    const client = documentClient({ data: orderRow({ wholesale_buyer_snapshot: snapshotBuyer, wholesale_terms_snapshot: snapshotTerms }) }, { data: SETTINGS });
    const r = await loadWholesaleDocumentData(client, { orderId: ORDER });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order).toMatchObject({ kind: "request", source: "checkout_snapshot" });
      expect(r.order.buyer.first_name).toBe("Congelado"); // no el del cliente vivo
      expect(r.order.terms.payment_terms).toBe("orig"); // no la configuración viva
    }
    expect(client.from).not.toHaveBeenCalledWith("wholesale_settings");
  });

  it("pedido MANUAL mayorista → 'order' armado con cliente + configuración vigentes", async () => {
    const r = await loadWholesaleDocumentData(documentClient({ data: orderRow() }, { data: SETTINGS }), { orderId: ORDER });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order).toMatchObject({ kind: "order", source: "order_live", humanCode: CODE });
      expect(r.order.buyer.first_name).toBe("Ana");
      expect(r.order.terms.payment_terms).toBe("50% seña");
      expect(r.order.items).toEqual([{ productName: "Taza", variantName: "Rosa", quantity: 2, unitPrice: 100 }]);
    }
  });

  it("pedido de otra unidad (minorista) sin checkout → 'not_wholesale': nunca entra al flujo mayorista", async () => {
    const r = await loadWholesaleDocumentData(documentClient({ data: orderRow({ business_units: { code: "retail" } }) }), { orderId: ORDER });
    expect(r).toEqual({ ok: false, reason: "not_wholesale", orderId: ORDER, humanCode: CODE });
  });

  it("manual sin cliente → missing_customer", async () => {
    const r = await loadWholesaleDocumentData(documentClient({ data: orderRow({ customers: null }) }), { orderId: ORDER });
    expect(r).toEqual({ ok: false, reason: "missing_customer", orderId: ORDER, humanCode: CODE });
  });

  it("sólo UN snapshot (dato inconsistente del checkout) → snapshot_incomplete; NO se completa con datos vivos", async () => {
    const onlyBuyer = await loadWholesaleDocumentData(documentClient({ data: orderRow({ wholesale_buyer_snapshot: CUSTOMER }) }, { data: SETTINGS }), { orderId: ORDER });
    const onlyTerms = await loadWholesaleDocumentData(documentClient({ data: orderRow({ wholesale_terms_snapshot: SETTINGS }) }, { data: SETTINGS }), { orderId: ORDER });
    expect(onlyBuyer).toMatchObject({ ok: false, reason: "snapshot_incomplete" });
    expect(onlyTerms).toMatchObject({ ok: false, reason: "snapshot_incomplete" });
  });

  it("inexistente → not_found; error de consulta → query_error con código", async () => {
    expect(await loadWholesaleDocumentData(documentClient({ data: null }), { orderId: ORDER })).toEqual({ ok: false, reason: "not_found" });
    expect(await loadWholesaleDocumentData(documentClient({ data: null, error: { code: "57014", message: "timeout" } }), { orderId: ORDER })).toEqual({
      ok: false, reason: "query_error", detail: "57014: timeout",
    });
  });

  it("falla la lectura de la configuración → query_error (no genera un PDF sin condiciones en silencio)", async () => {
    const r = await loadWholesaleDocumentData(documentClient({ data: orderRow() }, { data: null, error: { code: "42501", message: "rls" } }), { orderId: ORDER });
    expect(r).toMatchObject({ ok: false, reason: "query_error", detail: "42501: rls" });
  });

  it("sin fila de configuración → igual genera (condiciones vacías)", async () => {
    const r = await loadWholesaleDocumentData(documentClient({ data: orderRow() }, { data: null }), { orderId: ORDER });
    expect(r.ok).toBe(true);
  });
});
