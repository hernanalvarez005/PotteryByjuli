import { createClient } from "@/lib/supabase/server";

export { customerDisplayName, whatsappLink } from "./customers-shared";

export type CustomerListRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  whatsapp: string | null;
  email: string | null;
  company_name: string | null;
  city: string | null;
  is_active: boolean;
  customer_tag_links: { customer_tags: { id: string; code: string; name: string } }[];
};

/** Active customers only — archived ones are still reachable by direct link (an order, an enrollment) but stay out of the main list, per docs/business-rules.md § archivar. */
export async function getCustomers(): Promise<CustomerListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select(
      "id,first_name,last_name,whatsapp,email,company_name,city,is_active,customer_tag_links(customer_tags(id,code,name))"
    )
    .eq("is_active", true)
    .order("first_name");

  return (data ?? []) as unknown as CustomerListRow[];
}
