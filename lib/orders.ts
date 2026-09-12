import { createClient } from "@/lib/supabase/server";

export type OrderListRow = {
  id: string;
  human_code: string;
  status: string;
  total: number;
  created_at: string;
  customers: { first_name: string; last_name: string | null } | null;
  business_units: { name: string } | null;
};

/**
 * `operationType` filtra por `orders.operation_type` — 'order' para el
 * listado operativo de Pedidos (encargos/personalizados), 'retail_sale'
 * para el listado de Ventas recientes. Nunca mezclar ambos en la misma
 * pantalla: son dos vistas de un mismo modelo de datos, no dos tablas,
 * pero conceptualmente son operaciones distintas (ver auditoría "Próxima
 * evolución operativa de Pottery", Bloque 2).
 */
export async function getOrders(options?: {
  operationType?: "order" | "retail_sale";
}): Promise<{ orders: OrderListRow[]; paidByOrder: Record<string, number> }> {
  const supabase = await createClient();

  let query = supabase
    .from("orders")
    .select("id,human_code,status,total,created_at,customers(first_name,last_name),business_units(name)")
    .order("created_at", { ascending: false });
  if (options?.operationType) {
    query = query.eq("operation_type", options.operationType);
  }

  const [{ data: orders }, { data: payments }] = await Promise.all([
    query,
    supabase.from("payments").select("order_id,amount"),
  ]);

  const paidByOrder: Record<string, number> = {};
  for (const p of (payments ?? []) as { order_id: string; amount: number }[]) {
    paidByOrder[p.order_id] = (paidByOrder[p.order_id] ?? 0) + p.amount;
  }

  return { orders: (orders ?? []) as unknown as OrderListRow[], paidByOrder };
}
