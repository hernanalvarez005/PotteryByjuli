"use client";

import { useState, useTransition } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmAction } from "@/components/confirm-action";
import { ATTENDANCE_LABELS } from "@/schemas/workshops";
import { markAttendance, setEnrollmentStatus } from "./actions";

export type RosterRow = {
  enrollmentId: string;
  customerName: string;
  status: string;
  todayAttendance: string | null;
};

const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  active: "Activo",
  paused: "Pausado",
  cancelled: "Baja",
};

export function RosterTable({
  groupId,
  rows,
  todayLabel,
  canEdit,
}: {
  groupId: string;
  rows: RosterRow[];
  todayLabel: string;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState<RosterRow | null>(null);
  const todayIso = new Date().toISOString().slice(0, 10);

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo actualizar.");
      }
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Todavía no hay alumnos inscriptos.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Alumno/a</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Asistencia — {todayLabel}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.enrollmentId}>
            <TableCell className="font-medium">{row.customerName}</TableCell>
            <TableCell>
              {canEdit ? (
                <Select
                  value={row.status}
                  disabled={isPending}
                  onValueChange={(next) => {
                    if (!next) return;
                    if (next === "cancelled") {
                      setPendingCancel(row);
                      return;
                    }
                    run(() => setEnrollmentStatus(groupId, row.enrollmentId, next));
                  }}
                >
                  <SelectTrigger className="h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ENROLLMENT_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline">{ENROLLMENT_STATUS_LABELS[row.status]}</Badge>
              )}
            </TableCell>
            <TableCell>
              {canEdit ? (
                <div className="flex gap-1">
                  {Object.entries(ATTENDANCE_LABELS).map(([value, label]) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={row.todayAttendance === value ? "secondary" : "outline"}
                      disabled={isPending}
                      onClick={() =>
                        run(() => markAttendance(groupId, row.enrollmentId, todayIso, value))
                      }
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              ) : row.todayAttendance ? (
                <Badge variant="outline">{ATTENDANCE_LABELS[row.todayAttendance]}</Badge>
              ) : (
                <span className="text-sm text-muted-foreground">Sin registrar</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      </Table>
      <ConfirmAction
        open={pendingCancel !== null}
        onOpenChange={(next) => {
          if (!next) setPendingCancel(null);
        }}
        title="¿Dar de baja a este alumno/a?"
        description={`${pendingCancel?.customerName ?? ""} deja de contar para el cupo del grupo.`}
        confirmLabel="Dar de baja"
        onConfirm={async () => {
          if (!pendingCancel) return;
          // ConfirmAction closes itself (calls onOpenChange(false)) once this
          // resolves without throwing — that already clears pendingCancel via
          // the onOpenChange handler above, no need to do it again here.
          await setEnrollmentStatus(groupId, pendingCancel.enrollmentId, "cancelled");
        }}
      />
    </div>
  );
}
