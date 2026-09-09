"use client";

import { useTransition } from "react";
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
  const todayIso = new Date().toISOString().slice(0, 10);

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Todavía no hay alumnos inscriptos.
      </p>
    );
  }

  return (
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
                  onValueChange={(next) =>
                    next &&
                    startTransition(() => setEnrollmentStatus(groupId, row.enrollmentId, next))
                  }
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
                        startTransition(() =>
                          markAttendance(groupId, row.enrollmentId, todayIso, value)
                        )
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
  );
}
