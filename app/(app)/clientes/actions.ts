"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, hasRole, isOwner } from "@/lib/auth";
import { customerSchema, customerNoteSchema } from "@/schemas/customers";

export type CustomerActionState = { error?: string; customerId?: string };

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
