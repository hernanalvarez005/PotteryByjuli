import type { SupabaseClient } from "@supabase/supabase-js";

// Cleanup compartido de las suites de integración (Supabase LOCAL).
//
// Por qué existe: varias suites limpiaban con un `.delete().in(...)` cuyo
// error se ignoraba. Eso fallaba en silencio por tres razones y dejaba
// basura acumulándose en la base local corrida tras corrida:
//   - `order_items.product_variant_id`, `inventory_movements.inventory_item_id`
//     y `orders.price_condition_id` son NO ACTION: borrar un producto o una
//     condición con ventas/movimientos colgando falla.
//   - un `.in()` con ~1.800 ids revienta la URL (HTTP 414).
//   - el error nunca se miraba.
//
// Reglas de este helper: sólo IDs exactos registrados por la suite (nunca
// patrones), tandas chicas, orden respetando FKs, y si algún borrado falla
// se lanza un error explícito al final (después de intentar todo el resto).
// Nunca toca el seed: `retail`, `wholesale` ni la condición `general`.

const SEED_PRICE_LIST_CODES = ["retail", "wholesale"];
const SEED_PRICE_CONDITION_CODES = ["general"];

export const CLEANUP_CHUNK_SIZE = 50;

/** Parte una lista en tandas chicas: nunca un `.in()` gigante en la URL. */
export function chunk<T>(items: readonly T[], size = CLEANUP_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type StepResult = { error: { message: string } | null };
export type CleanupStep = (label: string, run: () => PromiseLike<StepResult>) => Promise<void>;

export type SuiteFixtures = {
  /** Pedidos creados directamente por la suite (además de los que se
   * descubren vendiendo las variantes de `productIds`). */
  orderIds?: readonly string[];
  productIds?: readonly string[];
  /** price_conditions creadas vía `create_price_condition`; se borra también
   * la price_list dedicada que trae cada una. */
  conditionIds?: readonly string[];
  customerIds?: readonly string[];
  categoryIds?: readonly string[];
};

/**
 * Borra los fixtures de una suite. Pensado para `afterAll`, así corre
 * aunque un assertion falle. `beforeCatalog` es para pasos propios de la
 * suite que no dependen del resto (p. ej. cuotas de taller).
 */
export async function cleanupFixtures(
  admin: SupabaseClient,
  suite: string,
  fixtures: SuiteFixtures,
  beforeCatalog?: (step: CleanupStep) => Promise<void>
): Promise<void> {
  const failures: string[] = [];
  const step: CleanupStep = async (label, run) => {
    try {
      const { error } = await run();
      if (error) failures.push(`${label}: ${error.message}`);
    } catch (e) {
      failures.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (beforeCatalog) await beforeCatalog(step);

  const productIds = [...(fixtures.productIds ?? [])];
  const conditionIds = [...(fixtures.conditionIds ?? [])];

  // IDs derivados de lo que creó la suite: variantes → inventory_items →
  // pedidos que las vendieron. Sólo desde `productIds` registrados.
  const variantIds: string[] = [];
  for (const ids of chunk(productIds)) {
    const { data } = await admin.from("product_variants").select("id").in("product_id", ids);
    variantIds.push(...(data ?? []).map((v) => v.id as string));
  }
  const inventoryItemIds: string[] = [];
  const orderIds = new Set(fixtures.orderIds ?? []);
  for (const ids of chunk(variantIds)) {
    const { data: items } = await admin.from("inventory_items").select("id").in("product_variant_id", ids);
    inventoryItemIds.push(...(items ?? []).map((i) => i.id as string));
    const { data: orderItems } = await admin.from("order_items").select("order_id").in("product_variant_id", ids);
    for (const oi of orderItems ?? []) orderIds.add(oi.order_id as string);
  }

  // Resolver las price_lists dedicadas ANTES de borrar las condiciones, y
  // negarse a tocar cualquier cosa del seed.
  const priceListIds: string[] = [];
  const conditionIdsToDelete: string[] = [];
  for (const ids of chunk(conditionIds)) {
    const { data } = await admin.from("price_conditions").select("id,code,price_list_id,price_lists(code)").in("id", ids);
    for (const row of (data ?? []) as unknown as {
      id: string;
      code: string;
      price_list_id: string;
      price_lists: { code: string } | null;
    }[]) {
      if (SEED_PRICE_CONDITION_CODES.includes(row.code) || SEED_PRICE_LIST_CODES.includes(row.price_lists?.code ?? "")) {
        failures.push(`price_conditions: ${suite} intentó borrar la condición/lista de seed '${row.code}' — se omite`);
        continue;
      }
      conditionIdsToDelete.push(row.id);
      priceListIds.push(row.price_list_id);
    }
  }

  // 1. Pedidos (cascada: order_items, payments, historial, reservas).
  for (const ids of chunk([...orderIds])) {
    await step("orders", () => admin.from("orders").delete().in("id", ids));
  }
  // 2. Movimientos y reservas de stock (inventory_items los referencia NO ACTION).
  for (const ids of chunk(inventoryItemIds)) {
    await step("inventory_movements", () => admin.from("inventory_movements").delete().in("inventory_item_id", ids));
    await step("inventory_reservations", () => admin.from("inventory_reservations").delete().in("inventory_item_id", ids));
  }
  // 3. Productos (cascada: variantes, inventory_items, price_list_items).
  for (const ids of chunk(productIds)) {
    await step("products", () => admin.from("products").delete().in("id", ids));
  }
  // 4. Condiciones (cascada: price_condition_payment_methods) y sus
  //    price_lists dedicadas (cascada: price_list_items) — recién ahora
  //    que ningún pedido las referencia.
  for (const ids of chunk(conditionIdsToDelete)) {
    await step("price_conditions", () => admin.from("price_conditions").delete().in("id", ids));
  }
  for (const ids of chunk(priceListIds)) {
    await step("price_lists", () => admin.from("price_lists").delete().in("id", ids));
  }
  // 5. Clientes y categorías.
  for (const ids of chunk(fixtures.customerIds ?? [])) {
    await step("customers", () => admin.from("customers").delete().in("id", ids));
  }
  for (const ids of chunk(fixtures.categoryIds ?? [])) {
    await step("product_categories", () => admin.from("product_categories").delete().in("id", ids));
  }

  if (failures.length > 0) throw new Error(`${suite}: cleanup incompleto:\n${failures.join("\n")}`);
}
