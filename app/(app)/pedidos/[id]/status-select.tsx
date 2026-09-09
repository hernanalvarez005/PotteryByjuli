"use client";

import { useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmAction } from "@/components/confirm-action";
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
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  if (!canEdit) {
    return <span className="text-sm">{ORDER_STATUS_LABELS[status]}</span>;
  }

  function apply(next: string) {
    setError(null);
    startTransition(async () => {
      try {
        await changeOrderStatus(orderId, next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo cambiar el estado.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Select
        value={status}
        disabled={isPending}
        onValueChange={(next) => {
          if (!next) return;
          if (next === "cancelled") {
            setConfirmingCancel(true);
            return;
          }
          apply(next);
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
      <ConfirmAction
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        title="¿Cancelar este pedido?"
        description="Libera cualquier stock reservado para este pedido. Esta acción no se puede deshacer."
        confirmLabel="Cancelar pedido"
        onConfirm={async () => {
          await changeOrderStatus(orderId, "cancelled");
        }}
      />
    </div>
  );
}
