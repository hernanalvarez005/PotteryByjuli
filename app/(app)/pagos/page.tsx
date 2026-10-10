import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { PAYMENT_LIST_SELECT, toPaymentListRow } from "@/lib/payments-list";
import { formatPeriodLabel } from "@/lib/workshop-dues";
import { PaymentCorrectDialog } from "@/components/payment-correct-dialog";
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
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");
  const supabase = await createClient();

  const [{ data: payments }, { data: methods }, { data: accounts }] = await Promise.all([
    supabase.from("payments").select(PAYMENT_LIST_SELECT).order("paid_at", { ascending: false }).limit(200),
    supabase.from("payment_methods").select("id,name").order("name"),
    supabase.from("payment_accounts").select("id,name").order("name"),
  ]);

  const rows = (payments ?? []).map(toPaymentListRow);
  const total = rows.reduce((sum, r) => sum + r.payment.amount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pagos</h1>
        <p className="text-muted-foreground">
          Todo lo cobrado, con su pedido o taller de origen. Esto es cobranza, no facturación — para eso está el total de
          cada pedido. Si un pago está mal cargado, corregilo desde acá: queda el historial.
        </p>
      </div>

      <Card className="w-fit">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Cobrado (últimos {rows.length} pagos)</CardTitle>
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
              <TableHead>Origen</TableHead>
              <TableHead>Cliente / alumna</TableHead>
              <TableHead>Importe</TableHead>
              <TableHead>Método</TableHead>
              <TableHead>Cuenta</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ payment, origin, person, methodName, accountName }) => {
              const originLabel =
                origin.kind === "order"
                  ? `Pedido ${origin.code}`
                  : origin.kind === "due"
                    ? `${origin.groupName} · cuota ${formatPeriodLabel(origin.period)}`
                    : "Sin origen";
              return (
                <TableRow key={payment.id}>
                  <TableCell>
                    {origin.kind === "order" ? (
                      <Link href={`/pedidos/${origin.orderId}`} className="hover:underline">
                        {origin.code}
                      </Link>
                    ) : origin.kind === "due" ? (
                      origin.groupId ? (
                        <Link href={`/talleres/${origin.groupId}`} className="hover:underline">
                          {originLabel}
                        </Link>
                      ) : (
                        originLabel
                      )
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {person ? (
                      <Link href={`/clientes/${person.id}`} className="hover:underline">
                        {person.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{formatCurrency(payment.amount)}</TableCell>
                  <TableCell className="text-muted-foreground">{methodName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{accountName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(payment.paid_at)}</TableCell>
                  <TableCell>
                    <PaymentCorrectDialog
                      payment={payment}
                      originLabel={originLabel}
                      paymentMethods={methods ?? []}
                      paymentAccounts={accounts ?? []}
                      canEdit={canEdit}
                    />
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
