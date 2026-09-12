import { createClient } from "@/lib/supabase/server";

export { customerDisplayName, whatsappLink } from "./customers-shared";

export type CustomerListRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  whatsapp: string | null;
  email: string | null;
  company_name: string | null;
  cuit: string | null;
  city: string | null;
  is_active: boolean;
  customer_tag_links: { customer_tags: { id: string; code: string; name: string } }[];
};

/** Escapa los caracteres especiales de `ilike`/`or` de PostgREST antes de
 * interpolar texto libre de un buscador en un filtro — sin esto, una coma
 * o un paréntesis en lo que alguien tipeó rompería la sintaxis de `.or()`
 * (o, peor, cambiaría qué compara el filtro). `%`/`_` (comodines de LIKE)
 * también se escapan para que buscar "10%" no actúe como wildcard. */
function escapePostgrestPattern(raw: string): string {
  return raw.replace(/[%_,()]/g, (c) => `\\${c}`);
}

/** Active customers only — archived ones are still reachable by direct
 * link (an order, an enrollment) but stay out of the main list, per
 * docs/business-rules.md § archivar. `query` busca por
 * Nombre/Apellido/WhatsApp/Email/Razón social/CUIT — server-side de
 * verdad (sección 19 de la tanda de usabilidad), no un filtro en React
 * sobre todo el listado. */
export async function getCustomers(query?: string): Promise<CustomerListRow[]> {
  const supabase = await createClient();
  let request = supabase
    .from("customers")
    .select(
      "id,first_name,last_name,whatsapp,email,company_name,cuit,city,is_active,customer_tag_links(customer_tags(id,code,name))"
    )
    .eq("is_active", true)
    .order("first_name");

  const trimmed = query?.trim();
  if (trimmed) {
    const pattern = `%${escapePostgrestPattern(trimmed)}%`;
    request = request.or(
      `first_name.ilike.${pattern},last_name.ilike.${pattern},whatsapp.ilike.${pattern},email.ilike.${pattern},company_name.ilike.${pattern},cuit.ilike.${pattern}`
    );
  }

  const { data } = await request;

  return (data ?? []) as unknown as CustomerListRow[];
}
