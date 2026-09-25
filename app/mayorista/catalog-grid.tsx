"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import type { WholesaleProduct } from "@/lib/wholesale";
import type { FeaturedSection } from "@/lib/wholesale-featured";
import { ProductCard } from "./product-card";
import { FeaturedSections } from "./featured-sections";

export function CatalogGrid({
  products,
  categories,
  featuredSections = [],
}: {
  products: WholesaleProduct[];
  categories: { id: string; name: string }[];
  featuredSections?: FeaturedSection[];
}) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (categoryId && p.categoryId !== categoryId) return false;
      if (query.trim() && !p.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
      return true;
    });
  }, [products, categoryId, query]);

  // Las secciones destacadas son para descubrir, no para interferir con
  // una intención explícita: con una búsqueda o un filtro de categoría
  // activo se muestra sólo el catálogo filtrado.
  const isFiltering = query.trim() !== "" || categoryId !== null;
  const showFeatured = featuredSections.length > 0 && !isFiltering;

  const usedCategoryIds = new Set(products.map((p) => p.categoryId));
  const visibleCategories = categories.filter((c) => usedCategoryIds.has(c.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar producto..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
        />
      </div>

      {visibleCategories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setCategoryId(null)}>
            <Badge variant={categoryId === null ? "secondary" : "outline"}>Todos</Badge>
          </button>
          {visibleCategories.map((c) => (
            <button key={c.id} type="button" onClick={() => setCategoryId(c.id)}>
              <Badge variant={categoryId === c.id ? "secondary" : "outline"}>{c.name}</Badge>
            </button>
          ))}
        </div>
      )}

      {showFeatured && <FeaturedSections sections={featuredSections} />}

      {showFeatured && <h2 className="text-lg font-semibold tracking-tight">Catálogo</h2>}

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No encontramos productos con ese filtro.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
