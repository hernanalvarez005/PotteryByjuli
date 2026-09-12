import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers";
import { formatCurrency } from "@/lib/format";
import {
  computeDueSummary,
  currentPeriod,
  previousPeriod,
  nextPeriod,
  formatPeriodLabel,
  DUE_STATUS_LABELS,
  type DueDisplayStatus,
} from "@/lib/workshop-dues";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { GenerateDuesForm } from "./generate-dues-form";
import { RegisterPaymentDialog } from "../[groupId]/dues-panel";

const STATUS_BADGE_VARIANT: Record<DueDisplayStatus, "secondary" | "outline" | "destructive"> = {
  paid: "secondary",
  partial: "outline",
  pending: "outline",
  cancelled: "destructive",
};

export default async function CuotasPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");
  if (!canEdit) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        No tenés permiso para ver esta sección.
      </p>
    );
  }

  const { period: periodParam } = await searchParams;
  const period = periodParam && /^\d{4}-\d{2}$/.test(periodParam) ? periodParam : currentPeriod();

  const supabase = await createClient();

  const [{ count: activeEnrollments }, { data: dueRows }, { data: paymentMethods }, { data: paymentAccounts }] = await Promise.all([
    supabase
      .from("workshop_enrollments")
      .select("id, workshop_groups!inner(archived_at)", { count: "exact", head: true })
      .eq("status", "active")
      .is("workshop_groups.archived_at", null),
    supabase
      .from("workshop_dues")
      .select(
        "id,enrollment_id,period,amount,due_date,status,payments(id,amount,paid_at,method_id,account_id,reference,notes),workshop_due_items(amount,voided_at),workshop_enrollments(group_id,customers(first_name,last_name),workshop_groups(name))"
      )
      .eq("period", period)
      .order("created_at"),
    supabase.from("payment_methods").select("id,name").eq("is_active", true).order("sort_order"),
    supabase.from("payment_accounts").select("id,name").eq("is_active", true).order("code"),
  ]);

  // computeDueSummary (lib/workshop-dues.ts) es la única fuente de verdad
  // para el total de una cuota — mismo cálculo que Talleres, la ficha de
  // alumna y el dashboard/reportes, nunca reimplementado acá.
  const dues = (dueRows ?? []).map((d) => {
    const payments = (d.payments ?? []) as {
      id: string;
      amount: number;
      paid_at: string;
      method_id: string | null;
      account_id: string | null;
      reference: string | null;
      notes: string | null;
    }[];
    const items = (d.workshop_due_items ?? []) as { amount: number; voided_at: string | null }[];
    const summary = computeDueSummary({ status: d.status as "pending" | "cancelled", amount: d.amount }, items, payments);
    const enrollment = d.workshop_enrollments as unknown as {
      group_id: string;
      customers: { first_name: string; last_name: string | null } | null;
      workshop_groups: { name: string } | null;
    } | null;
    return {
      id: d.id,
      groupId: enrollment?.group_id ?? "",
      groupName: enrollment?.workshop_groups?.name ?? "—",
      customerName: enrollment?.customers ? customerDisplayName(enrollment.customers) : "—",
      amount: summary.totalDue,
      extrasTotal: summary.extrasTotal,
      paidAmount: summary.paidTotal,
      balance: summary.balance,
      displayStatus: summary.status,
      payments,
    };
  });

  const totalBilled = dues.reduce((sum, d) => sum + d.amount, 0);
  const totalCollected = dues.reduce((sum, d) => sum + d.paidAmount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/talleres"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Talleres
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Cuotas</h1>
        <p className="text-muted-foreground">
          Generación mensual y cobranza — nunca confunde inscripta con pagada.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/talleres/cuotas?period=${previousPeriod(period)}`}>
          <Badge variant="outline" className="cursor-pointer">
            ← {formatPeriodLabel(previousPeriod(period))}
          </Badge>
        </Link>
        <span className="text-lg font-medium">{formatPeriodLabel(period)}</span>
        <Link href={`/talleres/cuotas?period=${nextPeriod(period)}`}>
          <Badge variant="outline" className="cursor-pointer">
            {formatPeriodLabel(nextPeriod(period))} →
          </Badge>
        </Link>
      </div>

      <GenerateDuesForm period={period} activeEnrollments={activeEnrollments ?? 0} duesCount={dues.length} />

      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          Facturación: <span className="font-medium">{formatCurrency(totalBilled)}</span>
        </span>
        <span>
          Cobrado: <span className="font-medium">{formatCurrency(totalCollected)}</span>
        </span>
        <span>
          Pendiente: <span className="font-medium">{formatCurrency(totalBilled - totalCollected)}</span>
        </span>
      </div>

      {dues.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay cuotas generadas para {formatPeriodLabel(period)}.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Alumna</TableHead>
              <TableHead>Grupo</TableHead>
              <TableHead>Importe</TableHead>
              <TableHead>Pagado</TableHead>
              <TableHead>Saldo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dues.map((due) => (
              <TableRow key={due.id}>
                <TableCell>{due.customerName}</TableCell>
                <TableCell className="text-muted-foreground">
                  <Link href={`/talleres/${due.groupId}`} className="hover:underline">
                    {due.groupName}
                  </Link>
                </TableCell>
                <TableCell>
                  {formatCurrency(due.amount)}
                  {due.extrasTotal > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      incl. {formatCurrency(due.extrasTotal)} en extras
                    </span>
                  )}
                </TableCell>
                <TableCell>{formatCurrency(due.paidAmount)}</TableCell>
                <TableCell>{formatCurrency(due.balance)}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGE_VARIANT[due.displayStatus]}>
                    {DUE_STATUS_LABELS[due.displayStatus]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {(due.payments.length > 0 ||
                    (due.displayStatus !== "paid" && due.displayStatus !== "cancelled")) && (
                    <RegisterPaymentDialog
                      groupId={due.groupId}
                      dueId={due.id}
                      customerName={due.customerName}
                      balance={due.balance}
                      paymentMethods={paymentMethods ?? []}
                      paymentAccounts={paymentAccounts ?? []}
                      payments={due.payments}
                      allowNewPayment={due.displayStatus !== "paid" && due.displayStatus !== "cancelled"}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
