"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, hasRole, isOwner } from "@/lib/auth";
import { customerSchema, customerNoteSchema } from "@/schemas/customers";

export type CustomerActionState = { error?: string; customerId?: string };

export type CustomerMatch = {
  id: string;
  name: string;
  whatsapp: string | null;
  email: string | null;
  /** Señales fuertes (whatsapp/email) primero — nombre es una señal débil,
   * nunca alcanza sola para fusionar nada automáticamente, sólo para
   * mostrarla como sugerencia de menor confianza. */
  matchedBy: ("whatsapp" | "email" | "name")[];
};

/** Mismos últimos N dígitos, ignorando cualquier prefijo de país/área y
 * cualquier formato (espacios, guiones, "+", "9" de WhatsApp AR, etc.) —
 * los customers existentes no están todos normalizados con
 * lib/phone.ts (esa normalización sólo corre en el checkout mayorista),
 * así que compararlos por sufijo es más robusto que un `.eq()` exacto. */
function phoneSuffix(raw: string, n = 8): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < n) return null;
  return digits.slice(-n);
}

/**
 * Búsqueda de coincidencias ANTES de crear un cliente nuevo (sección 2 de
 * la tanda de usabilidad) — nunca fusiona nada sola, sólo devuelve
 * candidatos para que la usuaria elija "Usar este cliente" o "Crear
 * igualmente". Señales fuertes (whatsapp/email) pesan más que el nombre:
 * se buscan por separado y se combinan, mismo espíritu que el dedup del
 * checkout mayorista (submit_wholesale_request) pero interactivo en vez
 * de automático — acá la usuaria decide, nunca el servidor.
 */
export async function findCustomerMatches(formData: FormData): Promise<CustomerMatch[]> {
  await assertCanManageCustomers();

  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  const supabase = await createClient();
  const matches = new Map<string, CustomerMatch>();

  function addMatch(row: { id: string; first_name: string; last_name: string | null; whatsapp: string | null; email: string | null }, signal: "whatsapp" | "email" | "name") {
    const existing = matches.get(row.id);
    if (existing) {
      if (!existing.matchedBy.includes(signal)) existing.matchedBy.push(signal);
      return;
    }
    matches.set(row.id, {
      id: row.id,
      name: [row.first_name, row.last_name].filter(Boolean).join(" "),
      whatsapp: row.whatsapp,
      email: row.email,
      matchedBy: [signal],
    });
  }

  const suffix = whatsapp ? phoneSuffix(whatsapp) : null;
  if (suffix) {
    // No se puede comparar por sufijo con `.ilike()` directamente: los
    // whatsapp existentes se guardaron con el formato que cada flujo tecleó
    // (espacios, guiones), así que el sufijo de sólo dígitos no aparece
    // como substring contiguo del valor crudo (p.ej. "5555-4444" nunca
    // matchea "%55554444"). Se compara en memoria, quitando todo lo que no
    // sea dígito de ambos lados — el volumen de clientes de este negocio
    // hace este trade-off razonable frente a mantener una columna
    // normalizada aparte.
    const { data } = await supabase
      .from("customers")
      .select("id,first_name,last_name,whatsapp,email")
      .eq("is_active", true)
      .not("whatsapp", "is", null);
    for (const row of data ?? []) {
      if (row.whatsapp && row.whatsapp.replace(/\D/g, "").endsWith(suffix)) addMatch(row, "whatsapp");
    }
  }

  if (email) {
    const { data } = await supabase
      .from("customers")
      .select("id,first_name,last_name,whatsapp,email")
      .eq("is_active", true)
      .ilike("email", email);
    for (const row of data ?? []) addMatch(row, "email");
  }

  if (firstName && lastName) {
    const { data } = await supabase
      .from("customers")
      .select("id,first_name,last_name,whatsapp,email")
      .eq("is_active", true)
      .ilike("first_name", firstName)
      .ilike("last_name", lastName);
    for (const row of data ?? []) addMatch(row, "name");
  }

  // Señales fuertes primero — el nombre nunca desplaza un match de
  // whatsapp/email al fondo de la lista.
  const strength = (m: CustomerMatch) => (m.matchedBy.includes("whatsapp") || m.matchedBy.includes("email") ? 0 : 1);
  return [...matches.values()].sort((a, b) => strength(a) - strength(b));
}

async function assertCanManageCustomers() {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) {
    throw new Error("No tenés permiso para editar clientes.");
  }
  return user;
}

export async function createCustomer(
  _prevState: CustomerActionState,
  formData: FormData
): Promise<CustomerActionState> {
  await assertCanManageCustomers();

  const parsed = customerSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("customers")
    .insert(parsed.data)
    .select("id")
    .single();
  if (error || !created) return { error: "No se pudo crear el cliente." };

  revalidatePath("/clientes");
  return { customerId: created.id };
}

export async function updateCustomer(
  customerId: string,
  _prevState: CustomerActionState,
  formData: FormData
): Promise<CustomerActionState> {
  await assertCanManageCustomers();

  const parsed = customerSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update(parsed.data)
    .eq("id", customerId);
  if (error) return { error: "No se pudo guardar." };

  revalidatePath(`/clientes/${customerId}`);
  revalidatePath("/clientes");
  return {};
}

export async function toggleCustomerTag(
  customerId: string,
  tagId: string,
  enabled: boolean
) {
  await assertCanManageCustomers();

  const supabase = await createClient();
  const { error } = enabled
    ? await supabase.from("customer_tag_links").insert({ customer_id: customerId, tag_id: tagId })
    : await supabase
        .from("customer_tag_links")
        .delete()
        .eq("customer_id", customerId)
        .eq("tag_id", tagId);

  if (error) throw new Error("No se pudo actualizar el tag.");
  revalidatePath(`/clientes/${customerId}`);
  revalidatePath("/clientes");
}

export async function addCustomerNote(
  customerId: string,
  _prevState: CustomerActionState,
  formData: FormData
): Promise<CustomerActionState> {
  const user = await assertCanManageCustomers();

  const parsed = customerNoteSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("customer_notes")
    .insert({ customer_id: customerId, author_id: user.id, note: parsed.data.note });
  if (error) return { error: "No se pudo guardar la nota." };

  revalidatePath(`/clientes/${customerId}`);
  return {};
}

export async function toggleCustomerActive(customerId: string, isActive: boolean) {
  await assertCanManageCustomers();

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ is_active: isActive })
    .eq("id", customerId);
  if (error) throw new Error("No se pudo actualizar.");

  revalidatePath(`/clientes/${customerId}`);
  revalidatePath("/clientes");
}

export async function deleteCustomer(customerId: string) {
  const user = await requireUser();
  if (!isOwner(user)) throw new Error("Sólo la administradora puede eliminar definitivamente.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_customer_safe", { p_id: customerId });
  if (error) throw new Error(error.message || "No se pudo eliminar.");

  revalidatePath("/clientes");
  redirect("/clientes");
}
