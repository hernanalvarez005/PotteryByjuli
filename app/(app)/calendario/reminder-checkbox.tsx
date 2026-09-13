"use client";

import { useTransition } from "react";
import { setReminderStatus } from "./actions";

/** Checkbox pendiente/completado inline (Bloque 7) — un recordatorio no
 * tiene una ficha propia, se marca desde donde aparece. */
export function ReminderCheckbox({
  reminderId,
  completed,
  canEdit,
}: {
  reminderId: string;
  completed: boolean;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <input
      type="checkbox"
      checked={completed}
      disabled={!canEdit || isPending}
      onChange={(e) => startTransition(() => setReminderStatus(reminderId, e.target.checked))}
      onClick={(e) => e.stopPropagation()}
      className="size-4 shrink-0 accent-chart-5"
      aria-label={completed ? "Marcar como pendiente" : "Marcar como completado"}
    />
  );
}
