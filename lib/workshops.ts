import { createClient } from "@/lib/supabase/server";

export type GroupRow = {
  id: string;
  name: string;
  schedule: string | null;
  capacity: number;
  is_active: boolean;
  archived_at: string | null;
  workshop_programs: { name: string } | null;
  locations: { name: string } | null;
  workshop_enrollments: { id: string; status: string }[];
};

export async function getGroupsByProgram() {
  const supabase = await createClient();
  const [{ data: programs }, { data: groups }] = await Promise.all([
    supabase.from("workshop_programs").select("id,name,description,is_active").order("name"),
    supabase
      .from("workshop_groups")
      .select(
        "id,name,schedule,capacity,is_active,archived_at,program_id,workshop_programs(name),locations(name),workshop_enrollments(id,status)"
      )
      .is("archived_at", null)
      .order("name"),
  ]);

  return { programs: programs ?? [], groups: (groups ?? []) as unknown as (GroupRow & { program_id: string })[] };
}
