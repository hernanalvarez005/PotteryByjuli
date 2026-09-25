import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner } from "@/lib/auth";
import { CATALOG_TABLES, CATALOG_TABLE_KEYS, type CatalogRow } from "@/lib/catalog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CatalogManager } from "./catalog-manager";
import { WholesaleSettingsForm, type WholesaleSettings } from "./wholesale-settings-form";
import { FeeSuggestionsManager } from "./fee-suggestions-manager";
import { FeaturedSectionsManager, type FeaturedSectionAdminRow } from "./featured-sections-manager";
import { getWholesaleCatalog } from "@/lib/wholesale";
import { fetchFeaturedSectionsAdmin, getFeaturedSectionStatus } from "@/lib/wholesale-featured";

export default async function ConfiguracionPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const results = await Promise.all(
    CATALOG_TABLE_KEYS.map((table) =>
      supabase.from(table).select("*").order("name")
    )
  );

  const rowsByTable = Object.fromEntries(
    CATALOG_TABLE_KEYS.map((table, i) => [table, (results[i].data ?? []) as CatalogRow[]])
  ) as Record<(typeof CATALOG_TABLE_KEYS)[number], CatalogRow[]>;

  const { data: wholesaleSettings } = await supabase
    .from("wholesale_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  const { data: feeSuggestions } = await supabase
    .from("payment_method_fee_suggestions")
    .select("id,payment_method_id,account_id,suggested_percentage")
    .order("payment_method_id");

  // Secciones destacadas del catálogo mayorista. "Oculto" = el producto no
  // está en el catálogo mayorista visible (getWholesaleCatalog es la única
  // fuente de esa regla — acá no se reimplementa). Sólo se pide el catálogo
  // si alguna sección tiene productos asociados.
  const featuredAdmin = await fetchFeaturedSectionsAdmin(supabase);
  const anyAssociations = featuredAdmin.some((s) => s.products.length > 0);
  const visibleProductIds = anyAssociations
    ? new Set((await getWholesaleCatalog()).products.map((p) => p.id))
    : new Set<string>();
  const now = new Date();
  const featuredSections: FeaturedSectionAdminRow[] = featuredAdmin.map((s) => ({
    id: s.id,
    title: s.title,
    slug: s.slug,
    description: s.description,
    is_active: s.is_active,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    status: getFeaturedSectionStatus(s, now),
    products: s.products.map((p) => ({ ...p, hidden: !visibleProductIds.has(p.productId) })),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground">
          Catálogos base que usa toda la plataforma. Cambiar algo acá lo
          actualiza en todos los módulos que lo usan.
        </p>
      </div>

      <Tabs defaultValue={CATALOG_TABLE_KEYS[0]}>
        <TabsList>
          {CATALOG_TABLE_KEYS.map((table) => (
            <TabsTrigger key={table} value={table}>
              {CATALOG_TABLES[table].label}
            </TabsTrigger>
          ))}
          {wholesaleSettings && <TabsTrigger value="wholesale">Mayorista</TabsTrigger>}
          <TabsTrigger value="featured">Secciones destacadas</TabsTrigger>
          <TabsTrigger value="fees">Comisiones</TabsTrigger>
        </TabsList>
        {CATALOG_TABLE_KEYS.map((table) => (
          <TabsContent key={table} value={table}>
            <CatalogManager
              table={table}
              label={CATALOG_TABLES[table].label}
              description={CATALOG_TABLES[table].description}
              fields={CATALOG_TABLES[table].fields}
              rows={rowsByTable[table]}
              canEdit={isOwner(user)}
            />
          </TabsContent>
        ))}
        {wholesaleSettings && (
          <TabsContent value="wholesale">
            <div className="flex flex-col gap-1 pb-4">
              <h3 className="font-medium">Condiciones mayoristas</h3>
              <p className="text-sm text-muted-foreground">
                Esto se muestra tal cual en el catálogo público de{" "}
                <code className="rounded bg-muted px-1 py-0.5">/mayorista</code>.
              </p>
            </div>
            <WholesaleSettingsForm
              settings={wholesaleSettings as WholesaleSettings}
              canEdit={isOwner(user)}
            />
          </TabsContent>
        )}
        <TabsContent value="featured">
          <FeaturedSectionsManager sections={featuredSections} canEdit={isOwner(user)} />
        </TabsContent>
        <TabsContent value="fees">
          <div className="flex flex-col gap-1 pb-4">
            <h3 className="font-medium">Comisiones por método de pago</h3>
            <p className="text-sm text-muted-foreground">
              Se usa para mostrar una comisión y un neto estimados en la venta rápida — el fee real
              de cada cobro siempre se confirma ahí, nunca lo decide esta configuración sola.
            </p>
          </div>
          <FeeSuggestionsManager
            suggestions={(feeSuggestions ?? []) as {
              id: string;
              payment_method_id: string;
              account_id: string | null;
              suggested_percentage: number;
            }[]}
            methods={rowsByTable.payment_methods.map((r) => ({ id: r.id, name: r.name as string }))}
            accounts={rowsByTable.payment_accounts.map((r) => ({ id: r.id, name: r.name as string }))}
            canEdit={isOwner(user)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
