"use server";

import { createClient } from "@/lib/supabase/server";
import { wholesaleRequestFormSchema } from "@/schemas/wholesale";

export type WholesaleRequestState = {
  error?: string;
  humanCode?: string;
};

export async function submitWholesaleRequest(
  _prevState: WholesaleRequestState,
  formData: FormData
): Promise<WholesaleRequestState> {
  let items: { product_variant_id: string; quantity: number }[];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "El carrito es inválido." };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { error: "Tu carrito está vacío." };
  }

  const parsed = wholesaleRequestFormSchema.safeParse({
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    company_name: formData.get("company_name"),
    cuit: formData.get("cuit"),
    instagram: formData.get("instagram"),
    website: formData.get("website"),
    city: formData.get("city"),
    province: formData.get("province"),
    whatsapp: formData.get("whatsapp"),
    email: formData.get("email"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  // No session here on purpose — this runs against the `anon` role, exactly
  // like a real visitor. The RPC itself is what's allowed to write.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_wholesale_request", {
    p_first_name: parsed.data.first_name,
    p_last_name: parsed.data.last_name,
    p_company_name: parsed.data.company_name,
    p_cuit: parsed.data.cuit,
    p_instagram: parsed.data.instagram,
    p_website: parsed.data.website,
    p_city: parsed.data.city,
    p_province: parsed.data.province,
    p_whatsapp: parsed.data.whatsapp,
    p_email: parsed.data.email,
    p_notes: parsed.data.notes,
    p_items: items,
  });

  if (error) {
    return { error: error.message || "No se pudo enviar la solicitud." };
  }

  return { humanCode: data as string };
}
