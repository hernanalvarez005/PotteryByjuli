import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/format";
import { PAYMENT_LIST_SELECT, toPaymentListRow } from "@/lib/payments-list";
import { formatPeriodLabel } from "@/lib/workshop-dues";
import { PaymentCorrectDialog } from "@/components/payment-correct-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const LIMIT = 50;

/**
 * Pagos de un cliente: los de sus pedidos/ventas y los de las cuotas de taller
 * en las que está inscripta. Sólo lectura + "Corregir" (mismo diálogo que
 * /pagos); el saldo de cada pedido se deriva de estos mismos pagos.
 */
export async function CustomerPaymentsCard({ customerId, canEdit }: { customerId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const orderSelect = PAYMENT_LIST_SELECT.replace("orders(", "orders!inner(");
  const dueSelect = PAYMENT_LIST_SELECT.replace("workshop_dues(", "workshop_dues!inner(").replace(
    "workshop_enrollments(",
    "workshop_enrollments!inner("
  );

  const [{ data: orderPayments }, { data: duePayments }, { data: methods }, { data: accounts }] = await Promise.all([
    supabase
      .from("payments")
      .select(orderSelect)
      .eq("orders.customer_id", customerId)
      .order("paid_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("payments")
      .select(dueSelect)
      .eq("workshop_dues.workshop_enrollments.customer_id", customerId)
      .order("paid_at", { ascending: false })
      .limit(LIMIT),
    supabase.from("payment_methods").select("id,name").order("name"),
    supabase.from("payment_accounts").select("id,name").order("name"),
  ]);

  const rows = [...(orderPayments ?? []), ...(duePayments ?? [])]
    .map(toPaymentListRow)
    .sort((a, b) => b.payment.paid_at.localeCompare(a.payment.paid_at))
    .slice(0, LIMIT);
  const total = rows.reduce((sum, r) => sum + r.payment.amount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pagos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no registró ningún pago.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {rows.length} pago{rows.length === 1 ? "" : "s"} · {formatCurrency(total)} cobrado
            </p>
            <ul className="flex flex-col gap-1 border-t pt-3 text-sm" data-testid="customer-payments">
              {rows.map(({ payment, origin, methodName }) => {
                const originLabel =
                  origin.kind === "order"
                    ? `Pedido ${origin.code}`
                    : origin.kind === "due"
                      ? `${origin.groupName} · cuota ${formatPeriodLabel(origin.period)}`
                      : "Sin origen";
                return (
                  <li key={payment.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      {origin.kind === "order" ? (
                        <Link href={`/pedidos/${origin.orderId}`} className="hover:underline">
                          {origin.code}
                        </Link>
                      ) : (
                        <span>{originLabel}</span>
                      )}
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatCurrency(payment.amount)}
                        {methodName ? ` · ${methodName}` : ""} · {formatDate(payment.paid_at)}
                      </span>
                    </span>
                    <PaymentCorrectDialog
                      payment={payment}
                      originLabel={originLabel}
                      paymentMethods={methods ?? []}
                      paymentAccounts={accounts ?? []}
                      canEdit={canEdit}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
