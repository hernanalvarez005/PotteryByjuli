import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnrollDialog } from "./enroll-dialog";
import { RosterTable, type RosterRow } from "./roster-table";
import { DuesPanel, type DueRow } from "./dues-panel";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const user = await requireUser();
  const canEditRoster =
    isOwner(user) || hasRole(user, "operations") || hasRole(user, "workshop_staff");
  const canEditDues = isOwner(user) || hasRole(user, "operations");

  const supabase = await createClient();
  const todayIso = new Date().toISOString().slice(0, 10);

  const { data: group } = await supabase
    .from("workshop_groups")
    .select("id,name,schedule,capacity,workshop_programs(name),locations(name)")
    .eq("id", groupId)
    .maybeSingle();

  if (!group) notFound();

  const [{ data: enrollments }, { data: allCustomers }] = await Promise.all([
    supabase
      .from("workshop_enrollments")
      .select("id,status,customer_id,customers(first_name,last_name)")
      .eq("group_id", groupId)
      .order("created_at"),
    supabase.from("customers").select("id,first_name,last_name").eq("is_active", true).order("first_name"),
  ]);

  const enrollmentIds = (enrollments ?? []).map((e) => e.id);

  const [{ data: dueRows }, { data: todayAttendance }] = await Promise.all([
    enrollmentIds.length
      ? supabase
          .from("workshop_dues")
          .select(
            "id,enrollment_id,period,amount,due_date,is_paid,workshop_enrollments(customers(first_name,last_name))"
          )
          .in("enrollment_id", enrollmentIds)
          .order("period", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    enrollmentIds.length
      ? supabase
          .from("attendance_records")
          .select("enrollment_id,status")
          .eq("session_date", todayIso)
          .in("enrollment_id", enrollmentIds)
      : Promise.resolve({ data: [] as { enrollment_id: string; status: string }[] }),
  ]);

  const attendanceByEnrollment = new Map((todayAttendance ?? []).map((a) => [a.enrollment_id, a.status]));

  const rosterRows: RosterRow[] = (enrollments ?? []).map((e) => ({
    enrollmentId: e.id,
    customerName: e.customers ? customerDisplayName(e.customers as unknown as { first_name: string; last_name: string | null }) : "—",
    status: e.status,
    todayAttendance: attendanceByEnrollment.get(e.id) ?? null,
  }));

  const dueList: DueRow[] = (dueRows ?? []).map((d) => ({
    id: d.id,
    enrollmentId: d.enrollment_id,
    customerName: (() => {
      const enrollment = d.workshop_enrollments as unknown as {
        customers: { first_name: string; last_name: string | null } | null;
      } | null;
      return enrollment?.customers ? customerDisplayName(enrollment.customers) : "—";
    })(),
    period: d.period,
    amount: d.amount,
    due_date: d.due_date,
    is_paid: d.is_paid,
  }));

  const enrollmentOptions = rosterRows
    .filter((r) => r.status === "active")
    .map((r) => ({ id: r.enrollmentId, customerName: r.customerName }));

  const enrolledCustomerIds = new Set((enrollments ?? []).map((e) => e.customer_id));
  const availableCustomers = (allCustomers ?? [])
    .filter((c) => !enrolledCustomerIds.has(c.id))
    .map((c) => ({ id: c.id, name: customerDisplayName(c) }));

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
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{group.name}</h1>
        <p className="text-sm text-muted-foreground">
          {(group.workshop_programs as unknown as { name: string } | null)?.name}
          {group.schedule && ` · ${group.schedule}`}
          {group.locations && ` · ${(group.locations as unknown as { name: string }).name}`}
        </p>
      </div>

      <Tabs defaultValue="asistencia">
        <TabsList>
          <TabsTrigger value="asistencia">Alumnos y asistencia</TabsTrigger>
          <TabsTrigger value="cuotas">Cuotas</TabsTrigger>
        </TabsList>
        <TabsContent value="asistencia" className="flex flex-col gap-4">
          {canEditRoster && (
            <div className="flex justify-end">
              <EnrollDialog groupId={groupId} customers={availableCustomers} />
            </div>
          )}
          <RosterTable
            groupId={groupId}
            rows={rosterRows}
            todayLabel={new Date().toLocaleDateString("es-AR")}
            canEdit={canEditRoster}
          />
        </TabsContent>
        <TabsContent value="cuotas">
          <DuesPanel
            groupId={groupId}
            dues={dueList}
            enrollments={enrollmentOptions}
            canEdit={canEditDues}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
