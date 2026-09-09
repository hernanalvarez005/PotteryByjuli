"use client";

import { useState, useTransition } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { completeTransfer } from "./actions";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  completed: "Completada",
  cancelled: "Cancelada",
};

export function TransferRow({
  id,
  humanCode,
  fromLocation,
  toLocation,
  status,
  createdAt,
  itemsSummary,
  canEdit,
}: {
  id: string;
  humanCode: string;
  fromLocation: string;
  toLocation: string;
  status: string;
  createdAt: string;
  itemsSummary: string;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <TableRow>
      <TableCell className="font-medium">{humanCode}</TableCell>
      <TableCell className="text-muted-foreground">
        {fromLocation} → {toLocation}
      </TableCell>
      <TableCell className="text-muted-foreground">{itemsSummary}</TableCell>
      <TableCell>
        <Badge variant={status === "completed" ? "secondary" : "outline"}>
          {STATUS_LABELS[status] ?? status}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDateTime(createdAt)}</TableCell>
      {canEdit && (
        <TableCell className="text-right">
          {status === "pending" && (
            <div className="flex flex-col items-end gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    try {
                      await completeTransfer(id);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "No se pudo completar.");
                    }
                  })
                }
              >
                {isPending ? "Completando..." : "Completar"}
              </Button>
              {error && <span className="text-xs text-destructive">{error}</span>}
            </div>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}
