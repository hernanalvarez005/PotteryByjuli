"use client";

import { useTransition } from "react";
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

  if (!canEdit) {
    return <span className="text-sm">{ORDER_STATUS_LABELS[status]}</span>;
  }

  return (
    <Select
      value={status}
      disabled={isPending}
      onValueChange={(next) => {
        if (next) startTransition(() => changeOrderStatus(orderId, next));
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
  );
}
