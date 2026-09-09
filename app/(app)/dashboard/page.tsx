import Link from "next/link";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getDashboardSummary } from "@/lib/reports";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const ROLE_LABELS: Record<string, string> = {
  owner: "Dueña",
  operations: "Operaciones",
  workshop_staff: "Taller",
  viewer: "Solo lectura",
};

export default async function DashboardPage() {
  const user = await requireUser();
  const hasAnyRole = user.roles.length > 0;
  const canSeeFinance = isOwner(user) || hasRole(user, "operations");

  const summary = hasAnyRole ? await getDashboardSummary() : null;

  const attentionItems = summary
    ? [
        summary.overdueOrdersCount > 0 && {
          label: `${summary.overdueOrdersCount} pedido${summary.overdueOrdersCount > 1 ? "s" : ""} atrasado${summary.overdueOrdersCount > 1 ? "s" : ""}`,
          href: "/pedidos",
        },
        summary.newWholesaleCount > 0 && {
          label: `${summary.newWholesaleCount} solicitud${summary.newWholesaleCount > 1 ? "es" : ""} mayorista${summary.newWholesaleCount > 1 ? "s" : ""} sin revisar`,
          href: "/mayoristas",
        },
        summary.pendingProductionCount > 0 && {
          label: `${summary.pendingProductionCount} orden${summary.pendingProductionCount > 1 ? "es" : ""} de producción activa${summary.pendingProductionCount > 1 ? "s" : ""}`,
          href: "/produccion",
        },
        summary.pendingDuesCount > 0 && {
          label: `${summary.pendingDuesCount} cuota${summary.pendingDuesCount > 1 ? "s" : ""} de taller pendiente${summary.pendingDuesCount > 1 ? "s" : ""}`,
          href: "/talleres",
        },
      ].filter((v): v is { label: string; href: string } => Boolean(v))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hola{user.fullName ? `, ${user.fullName}` : ""} 👋
        </h1>
        <p className="text-muted-foreground">Este es el resumen operativo de Pottery.</p>
      </div>

      {!hasAnyRole && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
          <CardHeader>
            <CardTitle className="text-base">Tu usuario todavía no tiene un rol asignado</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Pedile a quien administra Pottery que te asigne un rol (Dueña,
            Operaciones, Taller o Solo lectura) desde la tabla{" "}
            <code className="rounded bg-background px-1 py-0.5">user_roles</code> en
            Supabase.
          </CardContent>
        </Card>
      )}

      {hasAnyRole && (
        <div className="flex gap-2">
          {user.roles.map((role) => (
            <Badge key={role} variant="secondary">
              {ROLE_LABELS[role] ?? role}
            </Badge>
          ))}
        </div>
      )}

      {summary && canSeeFinance && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Kpi label="Ventas del mes" value={formatCurrency(summary.salesThisMonth)} />
          <Kpi label="Cobrado del mes" value={formatCurrency(summary.collectedThisMonth)} />
          <Kpi label="Pendiente de cobro" value={formatCurrency(summary.pendingToCollect)} />
          <Kpi label="Pedidos activos" value={String(summary.activeOrdersCount)} />
        </div>
      )}

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Necesita atención</CardTitle>
          </CardHeader>
          <CardContent>
            {attentionItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada pendiente por ahora.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {attentionItems.map((item) => (
                  <li key={item.label}>
                    <Link href={item.href} className="hover:underline">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {summary && summary.upcomingEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Próximos eventos</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {summary.upcomingEvents.map((e) => (
                <li key={e.id}>
                  <Link href={`/eventos/${e.id}`} className="hover:underline">
                    {e.name}
                  </Link>{" "}
                  <span className="text-muted-foreground">— {formatDate(e.event_date)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {!summary && hasAnyRole && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Todavía no hay datos que mostrar</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Empezá cargando algo en{" "}
            <Link href="/configuracion" className="underline underline-offset-2">
              Configuración
            </Link>
            .
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-xl font-semibold">{value}</CardContent>
    </Card>
  );
}
