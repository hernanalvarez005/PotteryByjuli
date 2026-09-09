import { createClient } from "@/lib/supabase/server";

export type PublicWorkshop = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  address: string | null;
  price: number | null;
  capacity: number | null;
  imageUrl: string | null;
  additional_info: string | null;
  status: string;
  is_registration_open: boolean;
  locationName: string | null;
  paymentAccount: { name: string; alias: string | null; holder_name: string | null } | null;
  confirmedCount: number;
};

/**
 * Everything the public workshop page needs, read entirely through the
 * anon-safe views from the Fase 9.5 migration (workshop_public_view,
 * location_public_view, payment_account_public_view) — never the base
 * tables, so there's no risk of leaking cost_estimate/notes/other
 * internal columns even if this function's shape changes later.
 */
export async function getPublicWorkshop(slug: string): Promise<PublicWorkshop | null> {
  const supabase = await createClient();

  const { data: workshop } = await supabase
    .from("workshop_public_view")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!workshop) return null;

  const [{ data: location }, { data: paymentAccount }] = await Promise.all([
    workshop.location_id
      ? supabase.from("location_public_view").select("name").eq("id", workshop.location_id).maybeSingle()
      : Promise.resolve({ data: null }),
    workshop.payment_account_id
      ? supabase
          .from("payment_account_public_view")
          .select("name,alias,holder_name")
          .eq("id", workshop.payment_account_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const imagesBucket = supabase.storage.from("event-images");
  const imageUrl = workshop.image_path
    ? imagesBucket.getPublicUrl(workshop.image_path).data.publicUrl
    : null;

  return {
    id: workshop.id,
    slug: workshop.slug,
    name: workshop.name,
    description: workshop.description,
    event_date: workshop.event_date,
    start_time: workshop.start_time,
    end_time: workshop.end_time,
    address: workshop.address,
    price: workshop.price,
    capacity: workshop.capacity,
    imageUrl,
    additional_info: workshop.additional_info,
    status: workshop.status,
    is_registration_open: workshop.is_registration_open,
    locationName: location?.name ?? null,
    paymentAccount: paymentAccount ?? null,
    confirmedCount: workshop.confirmed_count ?? 0,
  };
}
