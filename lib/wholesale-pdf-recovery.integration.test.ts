import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupFixtures } from "../tests/support/fixture-cleanup";
import { storeWholesaleOrderPdf, wholesalePdfStoragePath, ORDER_ATTACHMENTS_BUCKET } from "./wholesale-pdf-store";
import { getWholesalePdfStates, getMissingWholesalePdfOrderIds } from "./wholesale-document-state";

// Recuperación del PDF mayorista contra Supabase LOCAL real (Storage +
// Postgres): los cuatro estados DB/Storage, la idempotencia, la unicidad
// del adjunto, el estado derivado "Sin PDF" y la seguridad del bucket.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const BUYER = {
  first_name: "Fixture", last_name: "Recovery", company_name: "Fixture PDF", cuit: null, instagram: null, website: null,
  city: "Rosario", province: "Santa Fe", address: null, postal_code: null, whatsapp: "5493410000000", email: null,
};
const TERMS = { min_order_amount: null, min_total_units: null, lead_time_min_days: null, lead_time_max_days: null, payment_terms: null, shipping_terms: null };

const pdf = (label: string) => Buffer.from(`%PDF-1.4 fixture ${label}`);

describe("PDF mayorista — recuperación, idempotencia y seguridad (local)", () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let unitId: string;
  let variantId: string;
  const orderIds: string[] = [];
  const paths: string[] = [];

  async function makeOrder(kind: "web" | "manual") {
    const { data, error } = await admin
      .from("orders")
      .insert({
        business_unit_id: unitId,
        operation_type: "order",
        ...(kind === "web" ? { wholesale_buyer_snapshot: BUYER, wholesale_terms_snapshot: TERMS } : {}),
      })
      .select("id,human_code")
      .single();
    if (error) throw error;
    orderIds.push(data.id);
    await admin.from("order_items").insert({ order_id: data.id, product_variant_id: variantId, quantity: 2, unit_price: 100 });
    const path = wholesalePdfStoragePath(data.id, data.human_code);
    paths.push(path);
    return { orderId: data.id as string, humanCode: data.human_code as string, path };
  }

  const attachments = async (orderId: string) =>
    (await admin.from("order_attachments").select("id,storage_path,kind,uploaded_by").eq("order_id", orderId).eq("kind", "wholesale_request_pdf")).data ?? [];

  const objectSize = async (path: string) => {
    const { data } = await admin.storage.from(ORDER_ATTACHMENTS_BUCKET).download(path);
    return data ? (await data.arrayBuffer()).byteLength : null;
  };

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: unit } = await admin.from("business_units").select("id").eq("code", "wholesale").single();
    unitId = unit!.id;
    const { data: v } = await admin.from("product_variants").select("id").limit(1).single();
    variantId = v!.id;
  }, 30000);

  afterAll(async () => {
    if (paths.length) await admin.storage.from(ORDER_ATTACHMENTS_BUCKET).remove(paths);
    await cleanupFixtures(admin, "wholesale-pdf-recovery", { orderIds });
  }, 30000);

  describe("los cuatro estados DB/Storage", () => {
    it("NINGUNO (sin fila, sin archivo) → generación normal: 1 archivo + 1 fila", async () => {
      const o = await makeOrder("web");
      expect(await attachments(o.orderId)).toHaveLength(0);
      expect(await objectSize(o.path)).toBeNull();

      const stored = await storeWholesaleOrderPdf(admin, { orderId: o.orderId, humanCode: o.humanCode, pdfBytes: pdf("v1") });
      expect(stored).toBe(o.path);
      const rows = await attachments(o.orderId);
      expect(rows).toHaveLength(1);
      expect(rows[0].storage_path).toBe(o.path);
      expect(await objectSize(o.path)).toBe(pdf("v1").length);
    });

    it("HUÉRFANO en Storage (archivo sin fila) → se recupera: reemplaza el archivo y crea la fila", async () => {
      const o = await makeOrder("web");
      await admin.storage.from(ORDER_ATTACHMENTS_BUCKET).upload(o.path, pdf("archivo-viejo-mas-largo"), { contentType: "application/pdf" });
      expect(await attachments(o.orderId)).toHaveLength(0);

      await storeWholesaleOrderPdf(admin, { orderId: o.orderId, humanCode: o.humanCode, pdfBytes: pdf("nuevo") });
      expect(await attachments(o.orderId)).toHaveLength(1);
      expect(await objectSize(o.path)).toBe(pdf("nuevo").length); // reemplazado, no falló por "ya existe"
    });

    it("FILA HUÉRFANA (fila sin archivo) → recrea el archivo y REUSA la fila, sin crear otra", async () => {
      const o = await makeOrder("web");
      await admin.from("order_attachments").insert({ order_id: o.orderId, storage_path: o.path, kind: "wholesale_request_pdf" });
      expect(await objectSize(o.path)).toBeNull();

      await storeWholesaleOrderPdf(admin, { orderId: o.orderId, humanCode: o.humanCode, pdfBytes: pdf("recreado") });
      expect(await attachments(o.orderId)).toHaveLength(1);
      expect(await objectSize(o.path)).toBe(pdf("recreado").length);
    });

    it("NORMAL (fila + archivo) → regenerar reemplaza el contenido y mantiene una sola fila y la misma ruta", async () => {
      const o = await makeOrder("web");
      await storeWholesaleOrderPdf(admin, { orderId: o.orderId, humanCode: o.humanCode, pdfBytes: pdf("a") });
      const [before] = await attachments(o.orderId);
      await storeWholesaleOrderPdf(admin, { orderId: o.orderId, humanCode: o.humanCode, pdfBytes: pdf("bbbbbbbb") });
      const rows = await attachments(o.orderId);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(before.id); // misma fila reutilizada
      expect(rows[0].storage_path).toBe(o.path);
      expect(await objectSize(o.path)).toBe(pdf("bbbbbbbb").length);
    });
  });

  describe("idempotencia", () => {
    it("regenerar 5 veces seguidas nunca duplica la fila ni cambia la ruta", async () => {
      const o = await makeOrder("web");
      for (let i = 0; i < 5; i++) {
        expect(await storeWholesaleOrderPdf(admin, { orderId: o.orderId, humanCode: o.humanCode, pdfBytes: pdf(String(i)) })).toBe(o.path);
      }
      expect(await attachments(o.orderId)).toHaveLength(1);
    });

    it("ejecuciones concurrentes sobre el mismo pedido terminan con UNA sola fila", async () => {
      const o = await makeOrder("web");
      await Promise.all(
        Array.from({ length: 4 }, (_, i) => storeWholesaleOrderPdf(admin, { orderId: o.orderId, humanCode: o.humanCode, pdfBytes: pdf(`c${i}`) }))
      );
      expect(await attachments(o.orderId)).toHaveLength(1);
    });

    it("una fila previa con una ruta vieja/distinta se corrige a la ruta determinística", async () => {
      const o = await makeOrder("web");
      await admin.from("order_attachments").insert({ order_id: o.orderId, storage_path: `${o.orderId}/otro-nombre.pdf`, kind: "wholesale_request_pdf" });
      await storeWholesaleOrderPdf(admin, { orderId: o.orderId, humanCode: o.humanCode, pdfBytes: pdf("x") });
      const rows = await attachments(o.orderId);
      expect(rows).toHaveLength(1);
      expect(rows[0].storage_path).toBe(o.path);
    });
  });

  describe("índice único parcial (migración 20260925120000)", () => {
    it("un segundo wholesale_request_pdf para el mismo pedido se rechaza (23505)", async () => {
      const o = await makeOrder("web");
      await admin.from("order_attachments").insert({ order_id: o.orderId, storage_path: o.path, kind: "wholesale_request_pdf" });
      const { error } = await admin.from("order_attachments").insert({ order_id: o.orderId, storage_path: `${o.path}.2`, kind: "wholesale_request_pdf" });
      expect(error?.code).toBe("23505");
    });

    it("NO restringe a otros tipos de adjunto: varios de otro kind por pedido siguen permitidos", async () => {
      const o = await makeOrder("web");
      const { error } = await admin.from("order_attachments").insert([
        { order_id: o.orderId, storage_path: `${o.orderId}/foto-1.jpg`, kind: "reference_photo" },
        { order_id: o.orderId, storage_path: `${o.orderId}/foto-2.jpg`, kind: "reference_photo" },
        { order_id: o.orderId, storage_path: `${o.orderId}/sin-kind.pdf`, kind: null },
        { order_id: o.orderId, storage_path: `${o.orderId}/sin-kind-2.pdf`, kind: null },
      ]);
      expect(error).toBeNull();
    });

    it("dos pedidos distintos pueden tener cada uno su PDF", async () => {
      const a = await makeOrder("web");
      const b = await makeOrder("web");
      await storeWholesaleOrderPdf(admin, { orderId: a.orderId, humanCode: a.humanCode, pdfBytes: pdf("a") });
      await storeWholesaleOrderPdf(admin, { orderId: b.orderId, humanCode: b.humanCode, pdfBytes: pdf("b") });
      expect(await attachments(a.orderId)).toHaveLength(1);
      expect(await attachments(b.orderId)).toHaveLength(1);
    });
  });

  describe("indicador derivado 'Sin PDF' (sin pdf_status)", () => {
    it("web con PDF → tiene; web sin PDF → falta; pedido manual mayorista → NO aparece, aunque no tenga PDF", async () => {
      const withPdf = await makeOrder("web");
      const withoutPdf = await makeOrder("web");
      const manual = await makeOrder("manual");
      await storeWholesaleOrderPdf(admin, { orderId: withPdf.orderId, humanCode: withPdf.humanCode, pdfBytes: pdf("ok") });

      const ids = [withPdf.orderId, withoutPdf.orderId, manual.orderId];
      const states = await getWholesalePdfStates(admin, ids);
      expect(states.get(withPdf.orderId)).toEqual({ hasPdf: true });
      expect(states.get(withoutPdf.orderId)).toEqual({ hasPdf: false });
      expect(states.has(manual.orderId)).toBe(false); // nunca hubo intento automático

      const missing = await getMissingWholesalePdfOrderIds(admin, ids);
      expect([...missing]).toEqual([withoutPdf.orderId]);
    });

    it("regenerar hace desaparecer la señal", async () => {
      const o = await makeOrder("web");
      expect((await getMissingWholesalePdfOrderIds(admin, [o.orderId])).has(o.orderId)).toBe(true);
      await storeWholesaleOrderPdf(admin, { orderId: o.orderId, humanCode: o.humanCode, pdfBytes: pdf("x") });
      expect((await getMissingWholesalePdfOrderIds(admin, [o.orderId])).has(o.orderId)).toBe(false);
    });

    it("una lista vacía no dispara ninguna consulta ni rompe", async () => {
      expect((await getMissingWholesalePdfOrderIds(admin, [])).size).toBe(0);
    });
  });

  describe("seguridad", () => {
    it("el bucket order-attachments sigue siendo PRIVADO", async () => {
      const { data } = await admin.storage.getBucket(ORDER_ATTACHMENTS_BUCKET);
      expect(data?.public).toBe(false);
    });

    it("el comprador anónimo no puede insertar adjuntos arbitrarios", async () => {
      const o = await makeOrder("web");
      const { error } = await anon.from("order_attachments").insert({ order_id: o.orderId, storage_path: "x/y.pdf", kind: "wholesale_request_pdf" });
      expect(error).not.toBeNull();
      expect(await attachments(o.orderId)).toHaveLength(0);
    });

    it("el comprador anónimo no puede subir archivos al bucket, ni siquiera con upsert", async () => {
      const o = await makeOrder("web");
      const { error } = await anon.storage.from(ORDER_ATTACHMENTS_BUCKET).upload(o.path, pdf("anon"), { upsert: true, contentType: "application/pdf" });
      expect(error).not.toBeNull();
      expect(await objectSize(o.path)).toBeNull();
    });

    it("anónimo no puede pisar el PDF de un pedido que ya lo tiene", async () => {
      const o = await makeOrder("web");
      await storeWholesaleOrderPdf(admin, { orderId: o.orderId, humanCode: o.humanCode, pdfBytes: pdf("real") });
      await anon.storage.from(ORDER_ATTACHMENTS_BUCKET).upload(o.path, pdf("hackeado"), { upsert: true });
      expect(await objectSize(o.path)).toBe(pdf("real").length);
    });

    it("anónimo no puede leer las filas de adjuntos", async () => {
      const o = await makeOrder("web");
      await storeWholesaleOrderPdf(admin, { orderId: o.orderId, humanCode: o.humanCode, pdfBytes: pdf("x") });
      const { data } = await anon.from("order_attachments").select("id").eq("order_id", o.orderId);
      expect(data ?? []).toHaveLength(0);
    });
  });
});
