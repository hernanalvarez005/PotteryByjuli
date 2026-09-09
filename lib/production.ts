import { createClient } from "@/lib/supabase/server";
import type { ProductionOrderRow } from "@/lib/production-types";

export type { ProductionOrderRow } from "@/lib/production-types";
export { productionItemLabel } from "@/lib/production-types";

export async function getProductionOrders(): Promise<ProductionOrderRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("production_orders")
    .select(
      "id,human_code,origin,status,priority,quantity,produced_quantity,rejected_quantity,target_date,notes,created_at,order_id,product_variants(name,products(name)),locations(name)"
    )
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });

  return (data ?? []) as unknown as ProductionOrderRow[];
}
