import { createClient } from "@/lib/supabase/server";

export type EventRow = {
  id: string;
  human_code: string;
  event_type: string;
  name: string;
  event_date: string;
  status: string;
  capacity: number | null;
  price: number | null;
  locations: { name: string } | null;
  event_registrations: { quantity: number; status: string }[];
};

export async function getEvents(): Promise<EventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select(
      "id,human_code,event_type,name,event_date,status,capacity,price,locations(name),event_registrations(quantity,status)"
    )
    .order("event_date", { ascending: false });

  return (data ?? []) as unknown as EventRow[];
}
