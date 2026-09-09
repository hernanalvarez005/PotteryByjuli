import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PagosPage() {
  await requireUser();
  const supabase = await createClient();

  const { data: payments } = await supabase
    .from("payments")
    .select(
      "id,amount,paid_at,reference,orders(id,human_code,customers(first_name,last_name)),payment_methods(name),payment_accounts(name)"
    )
    .order("paid_at", { ascending: false })
    .limit(200);

  const rows = payments ?? [];
  const total = rows.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pagos</h1>
        <p className="text-muted-foreground">
          Todo lo cobrado, con su pedido de origen. Esto es cobranza, no
          facturación — para eso está el total de cada pedido.
        </p>
      </div>

      <Card className="w-fit">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">
            Cobrado (últimos {rows.length} pagos)
          </CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold">{formatCurrency(total)}</CardContent>
      </Card>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no se registró ningún pago.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Importe</TableHead>
              <TableHead>Método</TableHead>
              <TableHead>Cuenta</TableHead>
              <TableHead>Fecha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => {
              const order = p.orders as unknown as {
                id: string;
                human_code: string;
                customers: { first_name: string; last_name: string | null } | null;
              } | null;
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    {order ? (
                      <Link href={`/pedidos/${order.id}`} className="hover:underline">
                        {order.human_code}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {order?.customers
                      ? [order.customers.first_name, order.customers.last_name]
                          .filter(Boolean)
                          .join(" ")
                      : "—"}
                  </TableCell>
                  <TableCell>{formatCurrency(p.amount)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {(p.payment_methods as unknown as { name: string } | null)?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {(p.payment_accounts as unknown as { name: string } | null)?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(p.paid_at)}
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
