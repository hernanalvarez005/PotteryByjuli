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

export async function getOrders(): Promise<{ orders: OrderListRow[]; paidByOrder: Record<string, number> }> {
  const supabase = await createClient();

  const [{ data: orders }, { data: payments }] = await Promise.all([
    supabase
      .from("orders")
      .select("id,human_code,status,total,created_at,customers(first_name,last_name),business_units(name)")
      .order("created_at", { ascending: false }),
    supabase.from("payments").select("order_id,amount"),
  ]);

  const paidByOrder: Record<string, number> = {};
  for (const p of (payments ?? []) as { order_id: string; amount: number }[]) {
    paidByOrder[p.order_id] = (paidByOrder[p.order_id] ?? 0) + p.amount;
  }

  return { orders: (orders ?? []) as unknown as OrderListRow[], paidByOrder };
}
