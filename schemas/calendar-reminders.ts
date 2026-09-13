import { z } from "zod";
import { optionalString, optionalUuid } from "@/lib/zod-helpers";

export const calendarReminderSchema = z.object({
  title: z.string().trim().min(1, "Requerido").max(160),
  description: optionalString(500),
  remind_at: z.string().trim().min(1, "Requerido"),
  // Vínculo opcional a una fecha especial ya cargada — nunca la duplica,
  // sólo guarda su id (ver supabase/migrations/20260913180000_calendar_reminders.sql).
  special_date_id: optionalUuid(),
});
