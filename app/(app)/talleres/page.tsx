import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getGroupsByProgram } from "@/lib/workshops";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewProgramDialog } from "./new-program-dialog";
import { NewGroupDialog } from "./new-group-dialog";

export default async function TalleresPage() {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations") || hasRole(user, "workshop_staff");

  const supabase = await createClient();
  const [{ programs, groups }, { data: locations }] = await Promise.all([
    getGroupsByProgram(),
    supabase.from("locations").select("id,name").eq("is_active", true).order("name"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Talleres</h1>
          <p className="text-muted-foreground">
            Grupos regulares, cupo, alumnos y asistencia.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Link href="/talleres/cuotas">
              <Button size="sm" variant="outline">
                Cuotas
              </Button>
            </Link>
            <NewProgramDialog />
            <NewGroupDialog programs={programs} locations={locations ?? []} />
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay grupos. {programs.length === 0 && "Creá primero un programa."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => {
            const activeCount = group.workshop_enrollments.filter((e) => e.status === "active").length;
            const isFull = activeCount >= group.capacity;
            return (
              <Link key={group.id} href={`/talleres/${group.id}`}>
                <Card className="h-full transition-colors hover:bg-accent/50">
                  <CardHeader>
                    <CardTitle className="text-base">{group.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {group.workshop_programs?.name}
                    </p>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
                    {group.schedule && <p>{group.schedule}</p>}
                    {group.locations && <p>{group.locations.name}</p>}
                    <Badge variant={isFull ? "destructive" : "secondary"} className="w-fit">
                      {activeCount}/{group.capacity} inscriptos
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
