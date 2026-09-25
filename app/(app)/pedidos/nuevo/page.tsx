import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers";
import { OrderForm } from "./order-form";

export default async function NewOrderPage() {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");

  const supabase = await createClient();
  // El catálogo ya NO se precarga acá (perf audit H-08 bloque 5) — cada
  // fila de producto busca server-side vía VariantPicker
  // (searchSaleVariants(), lib/product-search.ts), igual que
  // /ventas/nueva. Con 3.352 productos activos, traer el catálogo
  // completo + sus precios acá ya rompía con HTTP 414 antes de este
  // cambio (confirmado por medición).
  const [{ data: customers }, { data: businessUnits }, { data: channels }, { data: locations }, { data: methods }, { data: accounts }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id,first_name,last_name")
        .eq("is_active", true)
        .order("first_name"),
      supabase.from("business_units").select("id,name,code").eq("is_active", true).order("sort_order"),
      supabase.from("sales_channels").select("id,name").eq("is_active", true).order("sort_order"),
      supabase.from("locations").select("id,name").eq("is_active", true).order("name"),
      supabase.from("payment_methods").select("id,name").eq("is_active", true).order("sort_order"),
      supabase.from("payment_accounts").select("id,name").eq("is_active", true).order("code"),
    ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/pedidos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Pedidos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Nuevo pedido</h1>
      </div>

      {!canEdit ? (
        <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          No tenés permiso para crear pedidos.
        </p>
      ) : (
        <OrderForm
          customers={(customers ?? []).map((c) => ({ id: c.id, name: customerDisplayName(c) }))}
          businessUnits={businessUnits ?? []}
          channels={channels ?? []}
          locations={locations ?? []}
          paymentMethods={methods ?? []}
          paymentAccounts={accounts ?? []}
        />
      )}
    </div>
  );
}
