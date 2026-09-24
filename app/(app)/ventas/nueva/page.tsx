import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers";
import { QuickSaleForm } from "./quick-sale-form";

export default async function QuickSalePage() {
  const user = await requireUser();
  const canSell = isOwner(user) || hasRole(user, "operations");

  const supabase = await createClient();
  const [
    { data: customers },
    { data: locations },
    { data: methods },
    { data: accounts },
    { data: channels },
    { data: priceConditions },
    { data: feeSuggestions },
  ] = await Promise.all([
    supabase
      .from("customers")
      .select("id,first_name,last_name")
      .eq("is_active", true)
      .order("first_name"),
    supabase.from("locations").select("id,name").eq("is_active", true).order("name"),
    supabase.from("payment_methods").select("id,name").eq("is_active", true).order("sort_order"),
    supabase.from("payment_accounts").select("id,name").eq("is_active", true).order("code"),
    supabase.from("sales_channels").select("id,name,code").eq("is_active", true).order("sort_order"),
    supabase.from("price_conditions").select("id,name").eq("is_active", true).order("sort_order").order("name"),
    // Sólo la comisión estimada a mostrar antes de cobrar (D.1/Bloque 3) —
    // nunca lo que decide el fee real, eso lo confirma la usuaria en el
    // momento del cobro.
    supabase.from("payment_method_fee_suggestions").select("payment_method_id,account_id,suggested_percentage"),
  ]);

  // El catálogo YA NO se carga acá (perf audit H-08) — a ~1.500+
  // variantes activas, traer todo + sus precios rompía con HTTP 414 en
  // getPricesForVariants(). QuickSaleForm busca server-side bajo demanda
  // (product-search.ts), nunca descarga el catálogo completo.
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/ventas"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Ventas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Nueva venta minorista</h1>
      </div>

      {!canSell ? (
        <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          No tenés permiso para registrar ventas.
        </p>
      ) : (priceConditions ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          Todavía no hay ninguna condición de precio activa.{" "}
          <Link href="/precios" className="underline underline-offset-2">
            Crear una en Precios
          </Link>
          .
        </p>
      ) : (
        <QuickSaleForm
          customers={(customers ?? []).map((c) => ({ id: c.id, name: customerDisplayName(c) }))}
          locations={locations ?? []}
          methods={methods ?? []}
          accounts={accounts ?? []}
          channels={channels ?? []}
          defaultChannelId={(channels ?? []).find((c) => c.code === "in_person")?.id ?? null}
          priceConditions={priceConditions ?? []}
          feeSuggestions={feeSuggestions ?? []}
        />
      )}
    </div>
  );
}
