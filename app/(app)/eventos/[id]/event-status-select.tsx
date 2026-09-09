"use client";

import { useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EVENT_STATUS_LABELS } from "@/schemas/events";
import { setEventStatus } from "./actions";

export function EventStatusSelect({
  eventId,
  status,
  canEdit,
}: {
  eventId: string;
  status: string;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  if (!canEdit) return <span className="text-sm">{EVENT_STATUS_LABELS[status]}</span>;

  return (
    <Select
      value={status}
      disabled={isPending}
      onValueChange={(next) => next && startTransition(() => setEventStatus(eventId, next))}
    >
      <SelectTrigger className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
