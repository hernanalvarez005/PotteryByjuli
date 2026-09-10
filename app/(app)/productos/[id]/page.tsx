import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { ProductInfoForm } from "./product-info-form";
import { VariantsPanel } from "./variants-panel";
import { PricesPanel } from "./prices-panel";
import { ImagesPanel, type ProductImage } from "./images-panel";
import { WholesaleRulesPanel, type WholesaleRules } from "./wholesale-rules-panel";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");

  const supabase = await createClient();

  const [{ data: product }, { data: categories }, { data: priceLists }, { data: images }, { data: wholesaleRules }] =
    await Promise.all([
      supabase
        .from("products")
        .select("id,name,description,cost_estimate,category_id,product_variants(id,name,sku,is_active)")
        .eq("id", id)
        .maybeSingle(),
      supabase.from("product_categories").select("id,name").order("name"),
      supabase.from("price_lists").select("id,code,name").order("name"),
      supabase
        .from("product_images")
        .select("id,storage_path,variant_id,is_primary")
        .eq("product_id", id)
        .order("sort_order"),
      supabase
        .from("wholesale_product_rules")
        .select("is_public,min_quantity,multiple_of,lead_time_days")
        .eq("product_id", id)
        .maybeSingle(),
    ]);

  if (!product) notFound();

  const variants = (product.product_variants ?? []) as {
    id: string;
    name: string;
    sku: string | null;
    is_active: boolean;
  }[];
  const variantIds = variants.map((v) => v.id);

  const { data: priceRows } = variantIds.length
    ? await supabase
        .from("price_list_items")
        .select("price_list_id,product_variant_id,unit_price")
        .in("product_variant_id", variantIds)
    : { data: [] as { price_list_id: string; product_variant_id: string; unit_price: number }[] };

  const prices: Record<string, number> = {};
  for (const row of priceRows ?? []) {
    prices[`${row.price_list_id}:${row.product_variant_id}`] = row.unit_price;
  }

  const imagesBucket = supabase.storage.from("product-images");
  const productImages: ProductImage[] = (images ?? []).map((img) => ({
    id: img.id,
    storage_path: img.storage_path,
    variant_id: img.variant_id,
    is_primary: img.is_primary,
    publicUrl: imagesBucket.getPublicUrl(img.storage_path).data.publicUrl,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/productos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Productos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{product.name}</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ProductInfoForm
          productId={product.id}
          name={product.name}
          categoryId={product.category_id}
          description={product.description}
          costEstimate={product.cost_estimate}
          categories={categories ?? []}
          canEdit={canEdit}
        />
        <ImagesPanel
          productId={product.id}
          images={productImages}
          variants={variants}
          canEdit={canEdit}
        />
        <VariantsPanel productId={product.id} variants={variants} canEdit={canEdit} />
        <PricesPanel
          productId={product.id}
          variants={variants}
          priceLists={priceLists ?? []}
          prices={prices}
          canEdit={isOwner(user)}
        />
        <WholesaleRulesPanel
          productId={product.id}
          rules={wholesaleRules as WholesaleRules}
          hasWholesalePrice={(() => {
            const wholesaleListId = (priceLists ?? []).find((pl) => pl.code === "wholesale")?.id;
            return wholesaleListId
              ? Object.keys(prices).some((key) => key.startsWith(`${wholesaleListId}:`))
              : false;
          })()}
          canEdit={isOwner(user)}
        />
      </div>
    </div>
  );
}
