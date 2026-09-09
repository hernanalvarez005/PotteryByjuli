import { createClient } from "@/lib/supabase/server";

export type EventRow = {
  id: string;
  human_code: string;
  event_type: string;
  name: string;
  slug: string | null;
  event_date: string;
  status: string;
  capacity: number | null;
  price: number | null;
  archived_at: string | null;
  locations: { name: string } | null;
  event_registrations: { quantity: number; status: string }[];
};

export async function getEvents(): Promise<EventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select(
      "id,human_code,event_type,name,slug,event_date,status,capacity,price,archived_at,locations(name),event_registrations(quantity,status)"
    )
    .order("event_date", { ascending: false });

  return (data ?? []) as unknown as EventRow[];
}

/** Registrations that actually hold a spot — matches the DB capacity check. */
export function heldQuantity(registrations: { quantity: number; status: string }[]): number {
  return registrations
    .filter((r) => r.status === "confirmed" || r.status === "attended")
    .reduce((sum, r) => sum + r.quantity, 0);
}
