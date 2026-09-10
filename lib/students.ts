import { createClient } from "@/lib/supabase/server";
import { customerDisplayName } from "@/lib/customers";
import {
  computeDueDisplayStatus,
  computeDueBalance,
  computeDueSummary,
  currentPeriod,
  lastPaidPeriod,
  type DueDisplayStatus,
} from "@/lib/workshop-dues";

export type StudentRosterRow = {
  customerId: string;
  customerName: string;
  whatsapp: string | null;
  enrollmentId: string;
  groupId: string;
  groupName: string;
  monthlyFee: number | null;
  currentPeriodStatus: DueDisplayStatus | "no_due";
  currentPeriodBalance: number | null;
  lastPaidPeriod: string | null;
};

/**
 * "Alumna" (sección 25) is inferred from the domain — an active enrollment
 * in a non-archived group — never solely a manual tag. One row per
 * (customer, group): a student in two groups (e.g. Lunes and Martes)
 * appears twice, matching how the business actually thinks about it.
 */
export async function getStudentRoster(period: string = currentPeriod()): Promise<StudentRosterRow[]> {
  const supabase = await createClient();

  const { data: enrollments } = await supabase
    .from("workshop_enrollments")
    .select(
      "id,customer_id,monthly_fee,group_id,customers(id,first_name,last_name,whatsapp),workshop_groups!inner(id,name,monthly_fee,archived_at)"
    )
    .eq("status", "active")
    .is("workshop_groups.archived_at", null);

  const enrollmentIds = (enrollments ?? []).map((e) => e.id);
  if (enrollmentIds.length === 0) return [];

  const { data: dueRows } = await supabase
    .from("workshop_dues")
    .select("enrollment_id,period,amount,status,payments(amount),workshop_due_items(amount,voided_at)")
    .in("enrollment_id", enrollmentIds);

  const duesByEnrollment = new Map<string, typeof dueRows>();
  for (const d of dueRows ?? []) {
    if (!duesByEnrollment.has(d.enrollment_id)) duesByEnrollment.set(d.enrollment_id, []);
    duesByEnrollment.get(d.enrollment_id)!.push(d);
  }

  return (enrollments ?? []).map((e) => {
    const customer = e.customers as unknown as {
      id: string;
      first_name: string;
      last_name: string | null;
      whatsapp: string | null;
    } | null;
    const group = e.workshop_groups as unknown as { id: string; name: string; monthly_fee: number | null };
    // computeDueSummary (lib/workshop-dues.ts) es la única fuente de
    // verdad para el total de una cuota — mismo cálculo que Talleres, la
    // ficha de alumna y el dashboard/reportes, nunca reimplementado acá.
    const dues = (duesByEnrollment.get(e.id) ?? []).map((d) => {
      const status = d.status as "pending" | "cancelled";
      const payments = (d.payments ?? []) as { amount: number }[];
      const items = (d.workshop_due_items ?? []) as { amount: number; voided_at: string | null }[];
      const summary = computeDueSummary({ status, amount: d.amount as number }, items, payments);
      return {
        period: d.period as string,
        status,
        amount: summary.totalDue,
        paidAmount: summary.paidTotal,
      };
    });

    const currentDue = dues.find((d) => d.period === period);
    const currentPeriodStatus: DueDisplayStatus | "no_due" = currentDue
      ? computeDueDisplayStatus(currentDue.status, currentDue.amount, currentDue.paidAmount)
      : "no_due";
    const currentPeriodBalance = currentDue ? computeDueBalance(currentDue.amount, currentDue.paidAmount) : null;

    return {
      customerId: customer?.id ?? "",
      customerName: customer ? customerDisplayName(customer) : "—",
      whatsapp: customer?.whatsapp ?? null,
      enrollmentId: e.id,
      groupId: group.id,
      groupName: group.name,
      monthlyFee: e.monthly_fee ?? group.monthly_fee,
      currentPeriodStatus,
      currentPeriodBalance,
      lastPaidPeriod: lastPaidPeriod(dues),
    };
  });
}
