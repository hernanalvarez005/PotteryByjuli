import { createClient } from "@/lib/supabase/server";

export type WholesaleVariant = {
  id: string;
  name: string;
  unitPrice: number;
};

export type WholesaleProduct = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  imageUrl: string | null;
  minQuantity: number | null;
  multipleOf: number | null;
  leadTimeDays: number | null;
  variants: WholesaleVariant[];
};

export type WholesaleSettingsPublic = {
  min_order_amount: number | null;
  min_total_units: number | null;
  lead_time_min_days: number | null;
  lead_time_max_days: number | null;
  payment_terms: string | null;
  shipping_terms: string | null;
  commercial_message: string | null;
  business_whatsapp: string | null;
};

/**
 * Everything the public /mayorista catalog needs, in one read-only pass.
 * Relies entirely on the `anon`-scoped RLS policies added in the Fase 5
 * migration — this file never bypasses them, so it's safe to call from a
 * page nobody is logged into.
 */
export async function getWholesaleCatalog() {
  const supabase = await createClient();

  const [{ data: categories }, { data: products }, { data: settings }] = await Promise.all([
    supabase.from("product_categories").select("id,name").order("sort_order"),
    supabase
      .from("products")
      .select(
        "id,name,description,category_id,product_variants(id,name),product_images(storage_path,is_primary,sort_order),wholesale_product_rules(min_quantity,multiple_of,lead_time_days)"
      )
      .order("name"),
    supabase.from("wholesale_settings").select("*").limit(1).maybeSingle(),
  ]);

  const variantIds = (products ?? []).flatMap((p) =>
    (p.product_variants as { id: string; name: string }[]).map((v) => v.id)
  );

  const { data: priceRows } = variantIds.length
    ? await supabase
        .from("price_list_items")
        .select("product_variant_id,unit_price")
        .in("product_variant_id", variantIds)
    : { data: [] as { product_variant_id: string; unit_price: number }[] };

  const priceByVariant = new Map((priceRows ?? []).map((r) => [r.product_variant_id, r.unit_price]));
  const imagesBucket = supabase.storage.from("product-images");

  const catalog: WholesaleProduct[] = (products ?? []).map((p) => {
    const images = (p.product_images ?? []) as unknown as {
      storage_path: string;
      is_primary: boolean;
      sort_order: number;
    }[];
    const primaryImage = images.find((i) => i.is_primary) ?? images[0];
    const rules = p.wholesale_product_rules as unknown as {
      min_quantity: number | null;
      multiple_of: number | null;
      lead_time_days: number | null;
    } | null;

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      categoryId: p.category_id,
      imageUrl: primaryImage
        ? imagesBucket.getPublicUrl(primaryImage.storage_path).data.publicUrl
        : null,
      minQuantity: rules?.min_quantity ?? null,
      multipleOf: rules?.multiple_of ?? null,
      leadTimeDays: rules?.lead_time_days ?? null,
      variants: (p.product_variants as { id: string; name: string }[])
        .map((v) => ({ id: v.id, name: v.name, unitPrice: priceByVariant.get(v.id) ?? 0 }))
        .filter((v) => v.unitPrice > 0),
    };
  });

  return {
    categories: categories ?? [],
    products: catalog.filter((p) => p.variants.length > 0),
    settings: (settings as WholesaleSettingsPublic | null) ?? null,
  };
}
