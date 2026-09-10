import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (ver playwright.config.ts y
// docs/testing.md § Entorno E2E) — nunca contra producción, ni siquiera con
// datos ficticios. Requiere `supabase start` + `.env.development.local` con
// las credenciales locales.
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

test.describe("Checkout mayorista — flujo completo anónimo", () => {
  test("catálogo → carrito → datos → revisión → enviar → confirmación", async ({ page }) => {
    await page.goto("/mayorista");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // Agregar 5 unidades (satisface min_order_amount=10000 y
    // min_total_units=5 del fixture de supabase/seed.sql).
    await page.getByRole("button", { name: "Agregar" }).first().click();
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "+" }).click();
    }
    await expect(page.getByRole("button", { name: /Ver carrito \(5\)/ })).toBeVisible();

    await page.getByRole("button", { name: "Ver carrito" }).click();
    await page.getByRole("button", { name: "Continuar" }).click();

    // Todos los campos obligatorios + un par de opcionales, para que la
    // revisión y el PDF tengan datos comerciales reales que verificar.
    const buyer = {
      first_name: "Juan",
      last_name: "Pérez",
      whatsapp: "11 2233-4455",
      email: "juan.e2e@casamagnolia.test",
      company_name: "Casa Magnolia E2E",
      city: "Rosario",
      province: "Santa Fe",
    };
    await page.getByLabel("Nombre *").fill(buyer.first_name);
    await page.getByLabel("Apellido *").fill(buyer.last_name);
    await page.getByLabel("WhatsApp *").fill(buyer.whatsapp);
    await page.getByLabel("Email *").fill(buyer.email);
    await page.getByLabel("Razón social / Nombre del comercio *").fill(buyer.company_name);
    await page.getByLabel("Ciudad *").fill(buyer.city);
    await page.getByLabel("Provincia *").fill(buyer.province);

    await page.getByRole("button", { name: "Revisar pedido" }).click();

    // Paso de revisión: datos correctos antes de enviar de verdad.
    await expect(page.getByText(`${buyer.first_name} ${buyer.last_name}`)).toBeVisible();
    await expect(page.getByText(buyer.company_name)).toBeVisible();
    await expect(page.getByText("5 × Taza E2E")).toBeVisible();

    await page.getByRole("button", { name: "Enviar solicitud de pedido" }).click();

    await expect(page.getByText("¡Recibimos tu solicitud!")).toBeVisible({ timeout: 15_000 });
    const codeLocator = page.getByText(/MAY-\d{6}/);
    await expect(codeLocator).toBeVisible();
    const humanCode = (await codeLocator.textContent())!.trim();

    // El CTA de WhatsApp existe y su URL apunta al pedido correcto.
    const whatsappLink = page.getByRole("link", { name: "Enviar pedido por WhatsApp" });
    await expect(whatsappLink).toBeVisible();
    const href = await whatsappLink.getAttribute("href");
    expect(href).toContain("wa.me/5491100000000");
    expect(decodeURIComponent(href!)).toContain(humanCode);
    expect(decodeURIComponent(href!)).toContain(buyer.company_name);

    // El botón de descarga del PDF sólo aparece si el documento se generó.
    await expect(page.getByRole("link", { name: "Descargar PDF" })).toBeVisible();

    // --- Verificación a nivel de datos ---
    const supabase = admin();
    const { data: order } = await supabase
      .from("orders")
      .select(
        "id, human_code, subtotal, total, customer_id, wholesale_buyer_snapshot, customers(first_name, whatsapp, email, company_name)"
      )
      .eq("human_code", humanCode)
      .single();

    expect(order).toBeTruthy();
    expect(order!.total).toBe(5 * 15000);
    expect(order!.subtotal).toBe(5 * 15000);

    const customer = order!.customers as unknown as {
      first_name: string;
      whatsapp: string;
      email: string;
      company_name: string;
    };
    expect(customer.first_name).toBe(buyer.first_name);
    expect(customer.company_name).toBe(buyer.company_name);
    expect(customer.email).toBe(buyer.email);
    // El teléfono debe haber quedado normalizado (con el "9" móvil
    // argentino), no tal cual se tipeó.
    expect(customer.whatsapp).toBe("5491122334455");

    const { data: items } = await supabase.from("order_items").select("quantity, unit_price").eq("order_id", order!.id);
    expect(items).toHaveLength(1);
    expect(items![0].quantity).toBe(5);
    expect(items![0].unit_price).toBe(15000);

    const { data: attachment } = await supabase
      .from("order_attachments")
      .select("storage_path, kind")
      .eq("order_id", order!.id)
      .maybeSingle();
    expect(attachment).toBeTruthy();
    expect(attachment!.kind).toBe("wholesale_request_pdf");

    // Limpieza — datos de prueba en la base LOCAL, no producción. Se
    // verifica cada paso porque un error silencioso acá dejaría un
    // customer/order huérfano en el fixture local entre corridas.
    const customerId = order!.customer_id as unknown as string;
    const { error: itemsErr } = await supabase.from("order_items").delete().eq("order_id", order!.id);
    expect(itemsErr).toBeNull();
    if (attachment) await supabase.storage.from("order-attachments").remove([attachment.storage_path]);
    const { error: attachErr } = await supabase.from("order_attachments").delete().eq("order_id", order!.id);
    expect(attachErr).toBeNull();
    const { error: orderErr } = await supabase.from("orders").delete().eq("id", order!.id);
    expect(orderErr).toBeNull();
    const { error: tagErr } = await supabase.from("customer_tag_links").delete().eq("customer_id", customerId);
    expect(tagErr).toBeNull();
    const { error: customerErr } = await supabase.from("customers").delete().eq("id", customerId);
    expect(customerErr).toBeNull();
  });

  test("rechaza el envío si falta un campo obligatorio, con mensaje específico", async ({ page }) => {
    await page.goto("/mayorista");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.getByRole("button", { name: "Agregar" }).first().click();
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "+" }).click();
    }
    await page.getByRole("button", { name: "Ver carrito" }).click();
    await page.getByRole("button", { name: "Continuar" }).click();

    // Deja "Apellido" vacío a propósito.
    await page.getByLabel("Nombre *").fill("Juan");
    await page.getByLabel("WhatsApp *").fill("1122334455");
    await page.getByLabel("Email *").fill("juan@test.com");
    await page.getByLabel("Razón social / Nombre del comercio *").fill("Casa Test");
    await page.getByLabel("Ciudad *").fill("CABA");
    await page.getByLabel("Provincia *").fill("Buenos Aires");

    await page.getByRole("button", { name: "Revisar pedido" }).click();

    await expect(page.getByText("Falta el apellido.")).toBeVisible();
    // Nunca avanza al paso de revisión con un campo obligatorio faltante.
    await expect(page.getByText("Revisá tu pedido")).not.toBeVisible();
  });
});
