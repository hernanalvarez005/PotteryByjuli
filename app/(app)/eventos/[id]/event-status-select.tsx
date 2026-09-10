"use client";

import { useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EVENT_STATUS_LABELS } from "@/schemas/events";
import { setEventStatus, publishEvent } from "./actions";

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
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) return <span className="text-sm">{EVENT_STATUS_LABELS[status]}</span>;

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

  return (
    <div className="flex flex-col gap-1">
      <Select
        items={EVENT_STATUS_LABELS}
        value={status}
        disabled={isPending}
        onValueChange={(next) => {
          if (!next) return;
          if (next === "published") {
            run(() => publishEvent(eventId));
          } else {
            run(() => setEventStatus(eventId, next));
          }
        }}
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
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
