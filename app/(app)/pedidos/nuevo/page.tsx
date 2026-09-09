import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getProductsWithVariants, getPricesForVariants } from "@/lib/products";
import { customerDisplayName } from "@/lib/customers";
import { OrderForm } from "./order-form";

export default async function NewOrderPage() {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");

  const supabase = await createClient();
  const [{ data: customers }, { data: businessUnits }, { data: channels }, { data: locations }, products] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id,first_name,last_name")
        .eq("is_active", true)
        .order("first_name"),
      supabase.from("business_units").select("id,name").eq("is_active", true).order("sort_order"),
      supabase.from("sales_channels").select("id,name").eq("is_active", true).order("sort_order"),
      supabase.from("locations").select("id,name").eq("is_active", true).order("name"),
      getProductsWithVariants(),
    ]);

  const activeVariantIds = products
    .filter((p) => p.is_active)
    .flatMap((p) => p.product_variants.filter((v) => v.is_active).map((v) => v.id));
  const prices = await getPricesForVariants(activeVariantIds);

  const variantOptions = products
    .filter((p) => p.is_active)
    .flatMap((p) =>
      p.product_variants
        .filter((v) => v.is_active)
        .map((v) => ({
          id: v.id,
          label: v.name === "Único" ? p.name : `${p.name} — ${v.name}`,
          retailPrice: prices[v.id]?.retail ?? null,
        }))
    );

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
          variants={variantOptions}
        />
      )}
    </div>
  );
}
