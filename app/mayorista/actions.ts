"use server";

import { createClient } from "@/lib/supabase/server";
import { wholesaleRequestFormSchema } from "@/schemas/wholesale";

export type WholesaleRequestState = {
  error?: string;
  humanCode?: string;
};

const GENERIC_ERROR = "No pudimos enviar tu solicitud. Revisá los datos ingresados e intentá nuevamente.";

/**
 * Never show a customer a raw Zod/Postgres error (sección 11) — a
 * structural bug like the missing `website` field (2026-09-09 P0:
 * "Invalid input: expected string, received null") must fail with a
 * generic, actionable message while the real detail goes to the server
 * log, not the browser. A schema issue we wrote ourselves on purpose
 * (`.min()`/`.refine()` messages like "Falta el nombre.") IS meant to
 * reach the customer as-is — only Zod's own default type-mismatch
 * wording gets swapped out.
 */
function friendlyValidationMessage(issue: { code: string; message: string } | undefined): string {
  if (!issue) return GENERIC_ERROR;
  const isOurOwnMessage = issue.code === "custom" || issue.code === "too_small" || issue.code === "too_big";
  return isOurOwnMessage ? issue.message : GENERIC_ERROR;
}

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

  // Reused across retries of the same checkout attempt (double click, a
  // visual error, a timeout) so the RPC can recognize "this is the same
  // request again" and return the existing order instead of duplicating it
  // (sección 10). Absent/malformed just means "no dedup for this call" —
  // never a reason to fail the submission.
  const rawClientRequestId = formData.get("client_request_id");
  const clientRequestId =
    typeof rawClientRequestId === "string" && rawClientRequestId.length > 0
      ? rawClientRequestId
      : null;

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
    console.error("submitWholesaleRequest: validation failed", parsed.error.issues);
    return { error: friendlyValidationMessage(parsed.error.issues[0]) };
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
    p_client_request_id: clientRequestId,
  });

  if (error) {
    console.error("submitWholesaleRequest: RPC failed", error);
    // 'P0001' is what a plain `raise exception 'texto en español'` inside
    // submit_wholesale_request surfaces as — those messages are written
    // by us on purpose for the customer to read (sección 132-141 of the
    // function). Anything else (constraint violation, connection issue,
    // etc.) is an internal error the customer never needs the detail of.
    return { error: error.code === "P0001" ? error.message : GENERIC_ERROR };
  }

  return { humanCode: data as string };
}
