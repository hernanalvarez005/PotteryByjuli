import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PDFParse } from "pdf-parse";
import { cleanupFixtures } from "../tests/support/fixture-cleanup";
import { renderWholesaleOrderPdf } from "./wholesale-pdf";
import {
  loadWholesaleDocumentData,
  loadWholesaleOrderForDocument,
  storeWholesaleOrderPdf,
  wholesalePdfStoragePath,
  ORDER_ATTACHMENTS_BUCKET,
  WHOLESALE_PDF_KIND,
} from "./wholesale-pdf-store";

// PDF de pedidos mayoristas: checkout (snapshots) vs cargados a mano
// (pedido + cliente + configuración), contra Supabase LOCAL real y con la
// sesión de una usuaria `operations` (la de la ficha). Cubre: el pedido del
// checkout conserva sus datos congelados, el manual genera un PDF válido,
// cliente completo / con opcionales en null, regeneración idempotente (una
// sola fila, misma ruta), que el pedido no se modifica y que un pedido
// minorista o sin cliente no entra al flujo mayorista.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";
const OPERATIONS_EMAIL = "operations-test@pottery.local";
const RUN = `ZZDOC${Date.now().toString(36)}`;

async function pdfText(bytes: ArrayBuffer | Buffer): Promise<string> {
  const parser = new PDFParse({ data: Buffer.from(bytes as ArrayBuffer) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

describe("PDF mayorista de pedidos manuales (local)", { timeout: 60000 }, () => {
  let admin: SupabaseClient;
  let ops: SupabaseClient;
  let opsUserId: string;
  let wholesaleUnitId: string;
  let retailUnitId: string;
  let variantId: string;
  const orderIds: string[] = [];
  const customerIds: string[] = [];
  const paths: string[] = [];

  const newCustomer = async (fields: Record<string, unknown>) => {
    const { data, error } = await admin.from("customers").insert({ first_name: `${RUN} Ana`, ...fields }).select("id").single();
    if (error) throw error;
    customerIds.push(data.id);
    return data.id as string;
  };

  /** Pedido cargado por el backoffice, como lo hace /pedidos/nuevo (RPC create_order con la sesión de operations). */
  const manualOrder = async (opts: { unitId: string; customerId: string | null; items?: unknown[] }) => {
    const { data: id, error } = await ops.rpc("create_order", {
      p_business_unit_id: opts.unitId,
      p_customer_id: opts.customerId,
      p_location_id: null,
      p_origin_channel_id: null,
      p_closing_channel_id: null,
      p_delivery_method: null,
      p_delivery_address: null,
      p_estimated_date: null,
      p_notes: null,
      p_items: opts.items ?? [
        { product_variant_id: variantId, quantity: 3, unit_price: 6000 },
        { custom_name: `${RUN} Tazas con logo`, quantity: 10, unit_price: 5000 },
      ],
    });
    if (error) throw error;
    orderIds.push(id as string);
    const { data: order } = await admin.from("orders").select("id,human_code").eq("id", id).single();
    paths.push(wholesalePdfStoragePath(order!.id, order!.human_code));
    return { orderId: order!.id as string, humanCode: order!.human_code as string };
  };

  const generate = async (orderId: string) => {
    const loaded = await loadWholesaleDocumentData(ops, { orderId });
    if (!loaded.ok) return loaded;
    const pdfBytes = await renderWholesaleOrderPdf({
      humanCode: loaded.order.humanCode,
      createdAt: new Date(loaded.order.createdAt),
      buyer: loaded.order.buyer,
      terms: loaded.order.terms,
      items: loaded.order.items,
      kind: loaded.order.kind,
    });
    await storeWholesaleOrderPdf(ops, { orderId, humanCode: loaded.order.humanCode, pdfBytes, uploadedBy: opsUserId });
    return loaded;
  };

  const attachments = async (orderId: string) =>
    (await admin.from("order_attachments").select("id,storage_path,uploaded_by").eq("order_id", orderId).eq("kind", WHOLESALE_PDF_KIND)).data ?? [];

  const downloadPdf = async (path: string) => {
    const { data, error } = await admin.storage.from(ORDER_ATTACHMENTS_BUCKET).download(path);
    if (error || !data) throw error ?? new Error("sin archivo");
    return Buffer.from(await data.arrayBuffer());
  };

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: users } = await admin.auth.admin.listUsers();
    let user = users.users.find((u) => u.email === OPERATIONS_EMAIL);
    if (!user) {
      const { data: created, error } = await admin.auth.admin.createUser({ email: OPERATIONS_EMAIL, password: PASSWORD, email_confirm: true });
      if (error) throw error;
      user = created.user!;
      await admin.from("user_roles").insert({ user_id: user.id, role: "operations" });
    }
    opsUserId = user.id;
    ops = createClient(SUPABASE_URL, ANON_KEY);
    const { error } = await ops.auth.signInWithPassword({ email: OPERATIONS_EMAIL, password: PASSWORD });
    if (error) throw error;

    wholesaleUnitId = (await admin.from("business_units").select("id").eq("code", "wholesale").single()).data!.id;
    retailUnitId = (await admin.from("business_units").select("id").eq("code", "retail").single()).data!.id;
    variantId = (await admin.from("product_variants").select("id, products!inner(name)").limit(1).single()).data!.id;
  });

  afterAll(async () => {
    if (paths.length) await admin.storage.from(ORDER_ATTACHMENTS_BUCKET).remove(paths);
    await cleanupFixtures(admin, "wholesale-document-manual", { orderIds, customerIds });
  });

  describe("pedido MANUAL mayorista", () => {
    it("genera un PDF de 'Pedido mayorista' (no una solicitud) con cliente, ítems del catálogo, ítem personalizado y total", async () => {
      const customerId = await newCustomer({
        last_name: "Gómez", company_name: `${RUN} Casa Ana`, cuit: "20-11111111-1", city: "Rosario", province: "Santa Fe",
        address: "Calle 1", postal_code: "2000", whatsapp: "5493410000000", email: "ana@example.com",
      });
      const { orderId, humanCode } = await manualOrder({ unitId: wholesaleUnitId, customerId });

      const loaded = await generate(orderId);
      expect(loaded.ok).toBe(true);

      const stored = await attachments(orderId);
      expect(stored).toHaveLength(1);
      expect(stored[0].storage_path).toBe(wholesalePdfStoragePath(orderId, humanCode));
      expect(stored[0].uploaded_by).toBe(opsUserId);

      const bytes = await downloadPdf(stored[0].storage_path);
      expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
      const text = await pdfText(bytes);
      expect(text).toContain(humanCode);
      expect(text).toContain("Pedido mayorista");
      expect(text).not.toContain("SOLICITUD PENDIENTE");
      expect(text).toContain(`${RUN} Casa Ana`);
      expect(text).toContain("ana@example.com");
      expect(text).toContain(`${RUN} Tazas con logo`);
      // 3*6000 + 10*5000 = 68.000
      expect(text).toContain("68.000");
    });

    it("cliente con TODOS los opcionales en null: genera un PDF válido sin líneas vacías", async () => {
      const customerId = await newCustomer({});
      const { orderId } = await manualOrder({ unitId: wholesaleUnitId, customerId });
      expect((await generate(orderId)).ok).toBe(true);
      const text = await pdfText(await downloadPdf((await attachments(orderId))[0].storage_path));
      expect(text).toContain(`${RUN} Ana`);
      for (const label of ["WhatsApp", "Email", "CUIT", "Ciudad"]) expect(text).not.toContain(label);
    });

    it("regenerar varias veces: una sola fila, misma ruta, mismo id de fila", async () => {
      const { orderId, humanCode } = await manualOrder({ unitId: wholesaleUnitId, customerId: await newCustomer({}) });
      await generate(orderId);
      const [first] = await attachments(orderId);
      for (let i = 0; i < 3; i++) await generate(orderId);
      const rows = await attachments(orderId);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(first.id);
      expect(rows[0].storage_path).toBe(wholesalePdfStoragePath(orderId, humanCode));
    });

    it("NO modifica el pedido: los snapshots del checkout siguen en null (no se inventa ninguno)", async () => {
      const { orderId } = await manualOrder({ unitId: wholesaleUnitId, customerId: await newCustomer({}) });
      await generate(orderId);
      const { data: order } = await admin.from("orders").select("wholesale_buyer_snapshot,wholesale_terms_snapshot").eq("id", orderId).single();
      expect(order).toEqual({ wholesale_buyer_snapshot: null, wholesale_terms_snapshot: null });
    });

    it("regenerar toma el dato ACTUAL del cliente (una dirección corregida)", async () => {
      const customerId = await newCustomer({ city: "Ciudad vieja" });
      const { orderId } = await manualOrder({ unitId: wholesaleUnitId, customerId });
      await generate(orderId);
      await admin.from("customers").update({ city: "Ciudad corregida" }).eq("id", customerId);
      await generate(orderId);
      const text = await pdfText(await downloadPdf((await attachments(orderId))[0].storage_path));
      expect(text).toContain("Ciudad corregida");
      expect(text).not.toContain("Ciudad vieja");
    });
  });

  describe("pedido del CHECKOUT (snapshots)", () => {
    const BUYER = {
      first_name: "Congelado", last_name: "Snap", company_name: `${RUN} Comercio congelado`, cuit: null, instagram: null, website: null,
      city: "Salta", province: "Salta", address: null, postal_code: null, whatsapp: "5493870000000", email: "snap@example.com",
    };
    const TERMS = { min_order_amount: 200000, min_total_units: 20, lead_time_min_days: 15, lead_time_max_days: 25, payment_terms: "TÉRMINOS CONGELADOS", shipping_terms: null };

    const webOrder = async (customerId: string) => {
      const { data, error } = await admin
        .from("orders")
        .insert({ business_unit_id: wholesaleUnitId, customer_id: customerId, operation_type: "order", wholesale_buyer_snapshot: BUYER, wholesale_terms_snapshot: TERMS })
        .select("id,human_code")
        .single();
      if (error) throw error;
      orderIds.push(data.id);
      paths.push(wholesalePdfStoragePath(data.id, data.human_code));
      await admin.from("order_items").insert({ order_id: data.id, product_variant_id: variantId, quantity: 2, unit_price: 100 });
      return { orderId: data.id as string, humanCode: data.human_code as string };
    };

    it("sigue usando los snapshots congelados aunque el cliente vivo sea otro: solicitud, con sus mínimos", async () => {
      const { orderId } = await webOrder(await newCustomer({ first_name: `${RUN} Cliente actual`, company_name: "Otro comercio" }));
      const loaded = await generate(orderId);
      if (!loaded.ok) throw new Error("no cargó");
      expect(loaded.order).toMatchObject({ kind: "request", source: "checkout_snapshot" });

      const text = await pdfText(await downloadPdf((await attachments(orderId))[0].storage_path));
      expect(text).toContain("SOLICITUD PENDIENTE DE CONFIRMACIÓN");
      expect(text).toContain(`${RUN} Comercio congelado`);
      expect(text).toContain("TÉRMINOS CONGELADOS");
      expect(text).toContain("Pedido mínimo");
      expect(text).not.toContain("Otro comercio");
    });

    it("el loader del backoffice devuelve EXACTAMENTE lo mismo que el loader del checkout", async () => {
      const { orderId } = await webOrder(await newCustomer({}));
      const viaBackoffice = await loadWholesaleDocumentData(ops, { orderId });
      const viaCheckout = await loadWholesaleOrderForDocument(ops, { orderId });
      expect(viaBackoffice).toEqual(viaCheckout);
    });
  });

  describe("pedidos que NO entran al flujo mayorista", () => {
    it("un pedido MINORISTA se rechaza (not_wholesale) y no genera nada", async () => {
      const { orderId } = await manualOrder({ unitId: retailUnitId, customerId: await newCustomer({}) });
      const result = await generate(orderId);
      expect(result).toMatchObject({ ok: false, reason: "not_wholesale" });
      expect(await attachments(orderId)).toHaveLength(0);
    });

    it("un pedido mayorista manual SIN cliente se rechaza (missing_customer)", async () => {
      const { orderId } = await manualOrder({ unitId: wholesaleUnitId, customerId: null });
      expect(await generate(orderId)).toMatchObject({ ok: false, reason: "missing_customer" });
      expect(await attachments(orderId)).toHaveLength(0);
    });

    it("un pedido con sólo UNO de los snapshots (inconsistente) se rechaza y no se completa con datos vivos", async () => {
      const { orderId } = await manualOrder({ unitId: wholesaleUnitId, customerId: await newCustomer({}) });
      await admin.from("orders").update({ wholesale_buyer_snapshot: { first_name: "Solo comprador", whatsapp: "1" } }).eq("id", orderId);
      expect(await generate(orderId)).toMatchObject({ ok: false, reason: "snapshot_incomplete" });
      expect(await attachments(orderId)).toHaveLength(0);
    });
  });

  describe("links para compartir (sesión de la usuaria, nunca la service role)", () => {
    it("un link firmado de 72 h y uno de descarga directa, minteados por `operations`, abren el PDF", async () => {
      const { orderId, humanCode } = await manualOrder({ unitId: wholesaleUnitId, customerId: await newCustomer({}) });
      await generate(orderId);
      const path = wholesalePdfStoragePath(orderId, humanCode);
      const bucket = ops.storage.from(ORDER_ATTACHMENTS_BUCKET);

      const view = await bucket.createSignedUrl(path, 72 * 3600);
      expect(view.error).toBeNull();
      const viewBody = Buffer.from(await (await fetch(view.data!.signedUrl)).arrayBuffer());
      expect(viewBody.subarray(0, 4).toString()).toBe("%PDF");

      const download = await bucket.createSignedUrl(path, 300, { download: `${humanCode}.pdf` });
      const response = await fetch(download.data!.signedUrl);
      expect(response.ok).toBe(true);
      expect(response.headers.get("content-disposition")).toContain("attachment");
    });
  });
});

