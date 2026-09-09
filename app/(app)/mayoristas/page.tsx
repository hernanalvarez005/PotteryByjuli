import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers";
import { formatCurrency, formatDate } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/schemas/orders";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default async function MayoristasPage() {
  await requireUser();
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id,human_code,status,total,created_at,customers(first_name,last_name,company_name,whatsapp),business_units!inner(code)"
    )
    .eq("business_units.code", "wholesale")
    .order("created_at", { ascending: false });

  const { data: payments } = await supabase.from("payments").select("order_id,amount");
  const paidByOrder: Record<string, number> = {};
  for (const p of payments ?? []) {
    paidByOrder[p.order_id] = (paidByOrder[p.order_id] ?? 0) + p.amount;
  }

  const rows = orders ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mayoristas</h1>
        <p className="text-muted-foreground">
          Solicitudes recibidas desde{" "}
          <Link href="/mayorista" target="_blank" className="underline underline-offset-2">
            el catálogo público
          </Link>
          , y pedidos mayoristas cargados a mano.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no llegó ninguna solicitud mayorista.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Comercio / Cliente</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Saldo</TableHead>
              <TableHead>Fecha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((order) => {
              const customer = order.customers as unknown as {
                first_name: string;
                last_name: string | null;
                company_name: string | null;
                whatsapp: string | null;
              } | null;
              const paid = paidByOrder[order.id] ?? 0;
              const balance = order.total - paid;

              return (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link href={`/pedidos/${order.id}`} className="font-medium hover:underline">
                      {order.human_code}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {customer?.company_name ?? (customer ? customerDisplayName(customer) : "—")}
                    {customer?.company_name && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {customerDisplayName(customer)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{ORDER_STATUS_LABELS[order.status]}</Badge>
                  </TableCell>
                  <TableCell>{formatCurrency(order.total)}</TableCell>
                  <TableCell className={balance > 0 ? "text-amber-600" : "text-muted-foreground"}>
                    {formatCurrency(balance)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(order.created_at)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
