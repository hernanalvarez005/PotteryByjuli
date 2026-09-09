import { createClient } from "@/lib/supabase/server";

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

export async function getCustomers(): Promise<CustomerListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select(
      "id,first_name,last_name,whatsapp,email,company_name,city,is_active,customer_tag_links(customer_tags(id,code,name))"
    )
    .order("first_name");

  return (data ?? []) as unknown as CustomerListRow[];
}

export function customerDisplayName(c: { first_name: string; last_name: string | null }) {
  return [c.first_name, c.last_name].filter(Boolean).join(" ");
}

/** wa.me link with a best-effort normalized phone (digits only, AR country code assumed if missing). */
export function whatsappLink(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, "");
  const withCountryCode = digits.startsWith("54") ? digits : `54${digits}`;
  return `https://wa.me/${withCountryCode}`;
}
