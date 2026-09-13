import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Corre exclusivamente contra Supabase LOCAL (nunca producción). Cubre
// income_entries (auditoría "Próxima evolución operativa de Pottery",
// Bloque 6 — Otros ingresos): sólo suma a "Cobrado", nunca a
// unidades/productos/stock, y sólo cuando el filtro de unidad/canal del
// dashboard es genuinamente "Todas" (no pertenece a ninguna unidad como
// sí le pasa a Talleres con "classes"). Mirror de las consultas de
// lib/reports.ts (getDashboardSummary/getIncomeEntriesSummary no son
// invocables acá — usan next/headers).

function loadEnvLocal() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const envPath = path.resolve(__dirname, "..", ".env.development.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isLocal = Boolean(SUPABASE_URL?.includes("127.0.0.1") || SUPABASE_URL?.includes("localhost"));
const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY && isLocal);

describe.skipIf(!hasCredentials)("income_entries (local)", () => {
  let admin: SupabaseClient;
  let locationId: string;
  let otherLocationId: string;
  let entryId: string;
  const fromIso = "2026-01-01T00:00:00Z";
  const toIso = "2099-12-31T23:59:59Z";

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: laPlata } = await admin.from("locations").select("id").eq("code", "la-plata").single();
    locationId = laPlata!.id;
    const { data: tresLomas } = await admin.from("locations").select("id").eq("code", "tres-lomas").single();
    otherLocationId = tresLomas!.id;

    const { data: entry } = await admin
      .from("income_entries")
      .insert({
        concept: "Alquiler espacio Acuarela",
        category: "Alquiler",
        amount: 45000,
        occurred_at: "2026-06-15T12:00:00-03:00",
        location_id: locationId,
      })
      .select("id")
      .single();
    entryId = entry!.id;
  });

  afterAll(async () => {
    await admin.from("income_entries").delete().eq("id", entryId);
  });

  it("insert rejects amount <= 0 — never a negative or zero income", async () => {
    const { error } = await admin
      .from("income_entries")
      .insert({ concept: "Inválido", amount: 0, occurred_at: new Date().toISOString() });
    expect(error).not.toBeNull();
  });

  it("mirrors getIncomeEntriesSummary: totals and groups by category", async () => {
    const { data } = await admin.from("income_entries").select("amount,category").gte("occurred_at", fromIso).lte("occurred_at", toIso);
    const rows = data ?? [];
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    expect(total).toBeGreaterThanOrEqual(45000);
    const byCategory = new Map<string, number>();
    for (const r of rows) byCategory.set(r.category ?? "Sin categoría", (byCategory.get(r.category ?? "Sin categoría") ?? 0) + r.amount);
    expect(byCategory.get("Alquiler")).toBe(45000);
  });

  it("a location filter mirrors getDashboardSummary's filteredIncomeQuery — only that location's entries count", async () => {
    const { data: matching } = await admin
      .from("income_entries")
      .select("amount")
      .eq("id", entryId)
      .eq("location_id", locationId)
      .gte("occurred_at", fromIso)
      .lte("occurred_at", toIso);
    expect(matching).toHaveLength(1);

    const { data: otherLocation } = await admin
      .from("income_entries")
      .select("amount")
      .eq("id", entryId)
      .eq("location_id", otherLocationId)
      .gte("occurred_at", fromIso)
      .lte("occurred_at", toIso);
    expect(otherLocation).toHaveLength(0);
  });

  it("never joins to order_items/products — architecturally cannot appear in 'productos más vendidos'", async () => {
    // getTopProducts consulta exclusivamente order_items — nunca
    // income_entries. Confirmar que el concepto del ingreso no aparece
    // como variante/producto en ningún lado del catálogo.
    const { data: matchingProducts } = await admin.from("products").select("id").eq("name", "Alquiler espacio Acuarela");
    expect(matchingProducts).toHaveLength(0);
    const { data: matchingVariants } = await admin
      .from("product_variants")
      .select("id,products!inner(name)")
      .eq("products.name", "Alquiler espacio Acuarela");
    expect(matchingVariants).toHaveLength(0);
  });

  it("never touches inventory_movements — cannot affect stock", async () => {
    const { count } = await admin
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("reference_table", "income_entries");
    expect(count).toBe(0);
  });
});
