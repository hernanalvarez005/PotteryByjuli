import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner } from "@/lib/auth";
import { CATALOG_TABLES, CATALOG_TABLE_KEYS, type CatalogRow } from "@/lib/catalog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CatalogManager } from "./catalog-manager";

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
      </Tabs>
    </div>
  );
}
