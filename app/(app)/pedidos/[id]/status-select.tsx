"use client";

import { useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ORDER_STATUS_LABELS, ORDER_STATUSES } from "@/schemas/orders";
import { changeOrderStatus } from "../actions";

export function StatusSelect({
  orderId,
  status,
  canEdit,
}: {
  orderId: string;
  status: string;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return <span className="text-sm">{ORDER_STATUS_LABELS[status]}</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      <Select
        value={status}
        disabled={isPending}
        onValueChange={(next) => {
          if (!next) return;
          setError(null);
          startTransition(async () => {
            try {
              await changeOrderStatus(orderId, next);
            } catch (e) {
              setError(e instanceof Error ? e.message : "No se pudo cambiar el estado.");
            }
          });
        }}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ORDER_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {ORDER_STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
