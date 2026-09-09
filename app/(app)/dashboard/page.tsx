import Link from "next/link";
import { requireUser } from "@/lib/auth";
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hola{user.fullName ? `, ${user.fullName}` : ""} 👋
        </h1>
        <p className="text-muted-foreground">
          Este es el resumen operativo de Pottery.
        </p>
      </div>

      {!hasAnyRole && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
          <CardHeader>
            <CardTitle className="text-base">
              Tu usuario todavía no tiene un rol asignado
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Pedile a quien administra Pottery que te asigne un rol (Dueña,
            Operaciones, Taller o Solo lectura) desde la tabla{" "}
            <code className="rounded bg-background px-1 py-0.5">user_roles</code>{" "}
            en Supabase. Mientras tanto vas a ver la plataforma en modo
            restringido.
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Todavía no hay nada que mostrar acá</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Los indicadores de ventas, cobros, stock y producción aparecen a
          medida que se implementan las siguientes fases (ver{" "}
          <code className="rounded bg-muted px-1 py-0.5">docs/roadmap.md</code>
          ). Por ahora podés revisar y ajustar la configuración base en{" "}
          <Link href="/configuracion" className="underline underline-offset-2">
            Configuración
          </Link>
          .
        </CardContent>
      </Card>
    </div>
  );
}
