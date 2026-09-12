import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers";
import { MergeCustomersForm } from "./merge-form";

export default async function MergeCustomersPage() {
  const user = await requireUser();

  if (!isOwner(user)) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        Sólo la administradora puede fusionar clientes.
      </p>
    );
  }

  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id,first_name,last_name")
    .eq("is_active", true)
    .order("first_name");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/clientes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Clientes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Fusionar clientes</h1>
        <p className="text-muted-foreground">
          El principal sobrevive. El duplicado nunca se borra — queda archivado, con su historial
          intacto.
        </p>
      </div>

      <MergeCustomersForm
        customers={(customers ?? []).map((c) => ({ id: c.id, name: customerDisplayName(c) }))}
      />
    </div>
  );
}
