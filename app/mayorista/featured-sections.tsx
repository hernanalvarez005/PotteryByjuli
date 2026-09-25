"use client";

import type { FeaturedSection } from "@/lib/wholesale-featured";
import { ProductCard } from "./product-card";

/**
 * Secciones destacadas arriba del catálogo general (merchandising). Cada
 * sección es sólo una referencia editorial: el producto sigue estando en
 * el catálogo normal, y reusa la misma ProductCard (misma variante,
 * mismo carrito, mismas imágenes optimizadas con next/image).
 *
 * Grilla y no carrusel horizontal, a propósito: cada tarjeta ya tiene su
 * propio carrusel de fotos con swipe horizontal, y anidar dos scrolls del
 * mismo eje se pelea con el gesto del usuario en mobile.
 *
 * Sin `priority` en las imágenes: no se pudo confirmar con una medición que
 * ayude (ver el PR) y el criterio es aplicarlo, como máximo, a 1–2 tarjetas
 * y sólo con evidencia. Todas mantienen el lazy loading normal de next/image.
 */
export function FeaturedSections({ sections }: { sections: FeaturedSection[] }) {
  return (
    <div className="flex flex-col gap-8">
      {sections.map((section) => (
        <section key={section.id} id={section.slug} aria-labelledby={`featured-${section.slug}`} className="scroll-mt-16">
          <h2 id={`featured-${section.slug}`} className="text-lg font-semibold tracking-tight">
            {section.title}
          </h2>
          {section.description && <p className="mt-0.5 text-sm text-muted-foreground">{section.description}</p>}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {section.products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
