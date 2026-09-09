// Imports Pottery's real Tienda Nube catalog export into the existing
// products/product_variants/price_list_items/inventory_movements model.
// No parallel tables — see docs/business-rules.md § Importación de datos
// reales and lib/import/tiendanube.ts for the mapping rules.
//
// Usage:
//   npx tsx scripts/import-tiendanube.ts --dry-run [--file=imports/tiendanube-products.csv]
//   npx tsx scripts/import-tiendanube.ts --apply --location=la-plata
//
// --dry-run is the default when neither flag is passed. --apply requires
// --location explicitly — the CSV doesn't say where this stock physically
// is, and that's not something this script gets to guess
// (docs/business-rules.md § Importación — ubicación del stock).

import { readFileSync } from "node:fs";
import {
  buildTiendaNubePlan,
  parseTiendaNubeCsv,
  TIENDANUBE_SOURCE,
  type ProductPlan,
  type TiendaNubePlan,
} from "../lib/import/tiendanube";
import { createAdminClient } from "./_supabase-admin";

type Args = { mode: "dry-run" | "apply"; file: string; location: string | null };

function parseArgs(argv: string[]): Args {
  const apply = argv.includes("--apply");
  const fileArg = argv.find((a) => a.startsWith("--file="));
  const locationArg = argv.find((a) => a.startsWith("--location="));
  return {
    mode: apply ? "apply" : "dry-run",
    file: fileArg ? fileArg.slice("--file=".length) : "imports/tiendanube-products.csv",
    location: locationArg ? locationArg.slice("--location=".length) : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n=== Import Tienda Nube (${args.mode}) ===\n`);

  const csvText = readFileSync(args.file, "utf-8");
  const rows = parseTiendaNubeCsv(csvText);
  const plan = buildTiendaNubePlan(rows);

  const admin = createAdminClient();

  const [{ data: categories, error: catErr }, { data: priceLists, error: plErr }, { data: locations, error: locErr }] =
    await Promise.all([
      admin.from("product_categories").select("id, code, name"),
      admin.from("price_lists").select("id, code"),
      admin.from("locations").select("id, code, name"),
    ]);
  if (catErr) throw catErr;
  if (plErr) throw plErr;
  if (locErr) throw locErr;

  const categoryIdByCode = new Map((categories ?? []).map((c) => [c.code, c.id as string]));
  const retailPriceList = (priceLists ?? []).find((p) => p.code === "retail");
  if (!retailPriceList) {
    throw new Error('No existe la lista de precios "retail" — revisar el seed de Fase 2.');
  }
  const locationByCode = new Map((locations ?? []).map((l) => [l.code, { id: l.id as string, name: l.name as string }]));

  const { data: existingProducts, error: existErr } = await admin
    .from("products")
    .select("id, external_id")
    .eq("external_source", TIENDANUBE_SOURCE);
  if (existErr) throw existErr;
  const existingByExternalId = new Map((existingProducts ?? []).map((p) => [p.external_id as string, p.id as string]));

  const newCategoryCodes = [...new Set(plan.categoriesDetected.filter((c) => c.isNew).map((c) => c.categoryCode!))].filter(
    (code) => !categoryIdByCode.has(code)
  );

  printDryRunReport(plan, {
    existingCount: existingByExternalId.size,
    newCategoryCodes,
    location: args.location ? locationByCode.get(args.location) ?? null : null,
    locationCodeArg: args.location,
  });

  if (args.mode === "dry-run") {
    console.log("\nDry-run únicamente — no se escribió nada. Ejecutar con --apply --location=<code> para aplicar.\n");
    return;
  }

  if (!args.location) {
    throw new Error(
      "--apply requiere --location=<code> (la-plata | tres-lomas) — el CSV no dice dónde está físicamente este stock."
    );
  }
  const location = locationByCode.get(args.location);
  if (!location) {
    throw new Error(`No existe una location con code="${args.location}". Locations disponibles: ${[...locationByCode.keys()].join(", ")}`);
  }

  // 1) Create any missing category the mapping proposes (today, just "madera").
  for (const code of newCategoryCodes) {
    const name = code.charAt(0).toUpperCase() + code.slice(1);
    const { data, error } = await admin
      .from("product_categories")
      .insert({ code, name, sort_order: 99 })
      .select("id")
      .single();
    if (error) throw error;
    categoryIdByCode.set(code, data.id as string);
    console.log(`+ categoría creada: ${code}`);
  }

  const summary = {
    productsCreated: 0,
    productsSkippedExisting: 0,
    variantsCreated: 0,
    variantsSkippedExisting: 0,
    pricesCreated: 0,
    pricesSkippedExisting: 0,
    movementsCreated: 0,
    movementsSkippedExisting: 0,
    errors: [] as string[],
  };

  for (const product of plan.products) {
    try {
      await importOneProduct({
        admin,
        product,
        categoryIdByCode,
        retailPriceListId: retailPriceList.id as string,
        locationId: location.id,
        existingByExternalId,
        summary,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${product.externalId}: ${message}`);
      console.error(`  ✗ ${product.externalId}: ${message}`);
    }
  }

  console.log("\n=== Resultado de la aplicación ===");
  console.log(`Productos creados:        ${summary.productsCreated}`);
  console.log(`Productos ya existentes:  ${summary.productsSkippedExisting}`);
  console.log(`Variantes creadas:        ${summary.variantsCreated}`);
  console.log(`Variantes ya existentes:  ${summary.variantsSkippedExisting}`);
  console.log(`Precios creados:          ${summary.pricesCreated}`);
  console.log(`Precios ya existentes:    ${summary.pricesSkippedExisting}`);
  console.log(`Movimientos de stock:     ${summary.movementsCreated}`);
  console.log(`Movimientos ya existentes:${summary.movementsSkippedExisting}`);
  if (summary.errors.length > 0) {
    console.log(`\nErrores (${summary.errors.length}):`);
    summary.errors.forEach((e) => console.log(`  - ${e}`));
    process.exitCode = 1;
  }
}

type ImportCtx = {
  admin: ReturnType<typeof createAdminClient>;
  product: ProductPlan;
  categoryIdByCode: Map<string, string>;
  retailPriceListId: string;
  locationId: string;
  existingByExternalId: Map<string, string>;
  summary: {
    productsCreated: number;
    productsSkippedExisting: number;
    variantsCreated: number;
    variantsSkippedExisting: number;
    pricesCreated: number;
    pricesSkippedExisting: number;
    movementsCreated: number;
    movementsSkippedExisting: number;
    errors: string[];
  };
};

async function importOneProduct(ctx: ImportCtx) {
  const { admin, product, categoryIdByCode, retailPriceListId, locationId, existingByExternalId, summary } = ctx;

  let productId = existingByExternalId.get(product.externalId) ?? null;
  let justCreated = false;

  if (!productId) {
    const { data, error } = await admin
      .from("products")
      .insert({
        name: product.name,
        description: product.description,
        category_id: product.categoryCode ? categoryIdByCode.get(product.categoryCode) ?? null : null,
        cost_estimate: product.costEstimate,
        is_active: product.isVisible,
        external_source: TIENDANUBE_SOURCE,
        external_id: product.externalId,
      })
      .select("id")
      .single();
    if (error) throw error;
    productId = data.id as string;
    justCreated = true;
    summary.productsCreated += 1;
    console.log(`+ producto: ${product.name} (${product.externalId})`);
  } else {
    summary.productsSkippedExisting += 1;
  }

  // The products_create_default_variant trigger already gave this product
  // one variant named "Único" the moment it was inserted. For a genuinely
  // simple product that's exactly right — reuse it, never create a
  // second one. For a multi-variant product it's a placeholder that needs
  // replacing with the real named variants.
  const { data: existingVariants, error: variantsErr } = await admin
    .from("product_variants")
    .select("id, name")
    .eq("product_id", productId);
  if (variantsErr) throw variantsErr;
  const variantByName = new Map((existingVariants ?? []).map((v) => [v.name as string, v.id as string]));

  if (justCreated && !product.isSimple && variantByName.has("Único") && variantByName.size === 1) {
    const defaultVariantId = variantByName.get("Único")!;
    const { count: refCount, error: refErr } = await admin
      .from("price_list_items")
      .select("id", { count: "exact", head: true })
      .eq("product_variant_id", defaultVariantId);
    if (refErr) throw refErr;
    if (!refCount) {
      const { error: delErr } = await admin.from("product_variants").delete().eq("id", defaultVariantId);
      if (delErr) throw delErr;
      variantByName.delete("Único");
    }
  }

  for (const plannedVariant of product.variants) {
    let variantId = variantByName.get(plannedVariant.name) ?? null;
    if (!variantId) {
      const { data, error } = await admin
        .from("product_variants")
        .insert({ product_id: productId, name: plannedVariant.name })
        .select("id")
        .single();
      if (error) throw error;
      variantId = data.id as string;
      variantByName.set(plannedVariant.name, variantId);
      summary.variantsCreated += 1;
    } else {
      summary.variantsSkippedExisting += 1;
    }

    // Price — insert-only. A price that's already there might have been
    // corrected by hand since the last import; this script never
    // overwrites a value it didn't create (docs/business-rules.md §
    // Nunca borrado físico — el mismo criterio aplica a "nunca pisado").
    if (product.retailPrice !== null) {
      const { count: priceExists, error: priceCheckErr } = await admin
        .from("price_list_items")
        .select("id", { count: "exact", head: true })
        .eq("price_list_id", retailPriceListId)
        .eq("product_variant_id", variantId);
      if (priceCheckErr) throw priceCheckErr;
      if (!priceExists) {
        const { error: priceErr } = await admin
          .from("price_list_items")
          .insert({ price_list_id: retailPriceListId, product_variant_id: variantId, unit_price: product.retailPrice });
        if (priceErr) throw priceErr;
        summary.pricesCreated += 1;
      } else {
        summary.pricesSkippedExisting += 1;
      }
    }

    // Stock — one initial_import movement per variant, only if one
    // doesn't already exist for that inventory item (idempotent) and
    // only if there's actually something to declare (a 0-quantity
    // movement is both meaningless and blocked by a DB check constraint;
    // the variant existing with no movement already reads as 0 stock).
    if (plannedVariant.stock > 0) {
      const { data: inventoryItem, error: invErr } = await admin
        .from("inventory_items")
        .select("id")
        .eq("product_variant_id", variantId)
        .single();
      if (invErr) throw invErr;

      const { count: movementExists, error: moveCheckErr } = await admin
        .from("inventory_movements")
        .select("id", { count: "exact", head: true })
        .eq("inventory_item_id", inventoryItem.id)
        .eq("movement_type", "initial_import");
      if (moveCheckErr) throw moveCheckErr;

      if (!movementExists) {
        const { error: moveErr } = await admin.from("inventory_movements").insert({
          inventory_item_id: inventoryItem.id,
          location_id: locationId,
          movement_type: "initial_import",
          quantity: plannedVariant.stock,
          reason: `Importación inicial — Tienda Nube (${product.externalId})`,
        });
        if (moveErr) throw moveErr;
        summary.movementsCreated += 1;
      } else {
        summary.movementsSkippedExisting += 1;
      }
    }
  }
}

function printDryRunReport(
  plan: TiendaNubePlan,
  extra: {
    existingCount: number;
    newCategoryCodes: string[];
    location: { id: string; name: string } | null;
    locationCodeArg: string | null;
  }
) {
  const { totals } = plan;
  console.log("PRODUCTOS");
  console.log(`  CSV rows: ${totals.csvRows}`);
  console.log(`  Productos detectados: ${totals.productsDetected}`);
  console.log(`  Productos físicos a importar: ${totals.physicalProducts}`);
  console.log(`  Productos legacy excluidos: ${totals.legacyExcluded}`);
  console.log(`  Productos visibles: ${totals.visible}`);
  console.log(`  Productos ocultos: ${totals.hidden}`);
  console.log(`  Ya importados en una corrida anterior (mismo external_id): ${extra.existingCount}`);

  console.log("\nSERVICIOS LEGACY EXCLUIDOS (WORKSHOP/SEÑA — no van al catálogo físico)");
  plan.legacyExcluded.forEach((l) => console.log(`  - ${l.name} (${l.externalId})`));

  console.log("\nVARIANTES");
  console.log(`  Total: ${totals.variantsTotal}`);

  console.log("\nSTOCK");
  console.log(`  Total unidades a importar: ${totals.stockTotal}`);
  console.log(
    `  Ubicación destino: ${extra.location ? `${extra.location.name} (${extra.locationCodeArg})` : "SIN CONFIRMAR — pasar --location=la-plata (o el code que corresponda) antes de --apply"}`
  );

  console.log("\nPRECIOS");
  console.log(`  Productos con precio: ${totals.physicalProducts - plan.products.filter((p) => p.retailPrice === null).length}`);
  console.log(`  Productos con promocional (documentado, no aplicado a ningún price_list): ${totals.withPromo}`);
  console.log(`  Productos con costo (products.cost_estimate): ${totals.withCost}`);

  console.log("\nCATEGORÍAS — mapping propuesto (revisar antes de --apply)");
  const uniqueMappings = new Map(plan.categoriesDetected.map((c) => [c.csvToken, c]));
  [...uniqueMappings.values()]
    .sort((a, b) => a.csvToken.localeCompare(b.csvToken))
    .forEach((m) => {
      const label = m.csvToken || "(sin categoría)";
      console.log(`  ${label} → ${m.categoryCode ?? "(sin mapear)"}${m.isNew ? "  [categoría NUEVA]" : ""}`);
    });
  if (extra.newCategoryCodes.length > 0) {
    console.log(`  Categorías nuevas a crear: ${extra.newCategoryCodes.join(", ")}`);
  }

  console.log("\nCAMPOS DEL CSV NO SOPORTADOS POR EL MODELO ACTUAL (no importados, documentado por si hace falta después)");
  console.log("  Peso/Alto/Ancho/Profundidad, Código de barras, Tags, Título/Descripción SEO, Marca, MPN, Sexo, Rango de edad, Envío sin cargo, Producto Físico");
  console.log("  Imágenes: el export no trae URLs — 0 imágenes importables en este archivo.");

  if (plan.warnings.length > 0) {
    console.log(`\nERRORES / AVISOS (${plan.warnings.length})`);
    plan.warnings.forEach((w) => console.log(`  - ${w.externalId}: ${w.message}`));
  } else {
    console.log("\nERRORES / AVISOS: ninguno");
  }
}

main().catch((err) => {
  console.error("\nImport falló:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
