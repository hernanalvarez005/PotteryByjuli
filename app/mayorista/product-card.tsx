"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { WholesaleProduct } from "@/lib/wholesale";
import { useCart } from "./cart-context";

export function ProductCard({ product }: { product: WholesaleProduct }) {
  const { cart, setQuantity } = useCart();
  const [selectedVariantId, setSelectedVariantId] = useState(product.variants[0]?.id ?? "");
  const variant = product.variants.find((v) => v.id === selectedVariantId) ?? product.variants[0];
  const inCart = variant ? (cart[variant.id] ?? 0) : 0;
  // Passed as Select's `items` prop — without it, Base UI's <Select.Value>
  // can't resolve a label for a value that's already selected before the
  // popup (where <Select.Item>s register) has ever opened, and falls back
  // to showing the raw value — a variant UUID, not its name. Same root
  // cause already fixed once in the admin bulk-price dialog; this is the
  // customer-facing instance of the exact same Select-mount-timing bug.
  const variantLabelsById = Object.fromEntries(product.variants.map((v) => [v.id, v.name]));

  if (!variant) return null;

  const step = product.multipleOf ?? 1;
  const min = product.minQuantity ?? step;

  return (
    <Card className="overflow-hidden py-0">
      <ProductCarousel
        images={product.images}
        productName={product.name}
        selectedVariantId={selectedVariantId}
        onVariantSelectedBySwipe={setSelectedVariantId}
      />
      <CardContent className="flex flex-col gap-2 p-3">
        <div>
          <h3 className="text-sm font-medium leading-tight">{product.name}</h3>
          <p className="text-sm text-muted-foreground">{formatCurrency(variant.unitPrice)}</p>
        </div>

        {product.variants.length > 1 && (
          <Select
            items={variantLabelsById}
            value={selectedVariantId}
            onValueChange={(v) => v && setSelectedVariantId(v)}
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {product.variants.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(product.minQuantity || product.multipleOf) && (
          <p className="text-[11px] text-muted-foreground">
            {product.minQuantity ? `Mín. ${product.minQuantity}` : ""}
            {product.minQuantity && product.multipleOf ? " · " : ""}
            {product.multipleOf ? `de a ${product.multipleOf}` : ""}
          </p>
        )}

        {inCart > 0 ? (
          <div className="flex items-center justify-between gap-2">
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() => setQuantity(variant.id, Math.max(0, inCart - step))}
            >
              −
            </Button>
            <span className="text-sm font-medium">{inCart}</span>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() => setQuantity(variant.id, inCart + step)}
            >
              +
            </Button>
          </div>
        ) : (
          // Always adds the currently selected variant — whether that
          // selection came from the <Select> above or from the carousel
          // (swipe/arrows), never a stale one from before either synced.
          <Button size="sm" className="w-full" onClick={() => setQuantity(variant.id, min)}>
            Agregar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Carrusel de imágenes ↔ variante seleccionada, sincronizado en ambos
 * sentidos sin loop infinito:
 *
 * - Swipe/flechas/puntos (usuario) → IntersectionObserver detecta la
 *   imagen visible → si tiene variantId, actualiza la variante
 *   seleccionada. Una imagen general (variantId null) nunca la toca.
 * - Cambiar la variante por el <Select> de arriba → busca la primera
 *   imagen de esa variante y hace scroll ahí programáticamente.
 *
 * El ciclo IntersectionObserver → setVariant → scrollIntoView →
 * IntersectionObserver → ... se corta con isProgrammaticScrollRef: se
 * pone en true justo antes del scroll disparado por el <Select>, y el
 * observer ignora cualquier intersección mientras siga en true (se
 * resetea con el evento `scrollend`, o un debounce corto si el browser no
 * lo soporta).
 */
function ProductCarousel({
  images,
  productName,
  selectedVariantId,
  onVariantSelectedBySwipe,
}: {
  images: WholesaleProduct["images"];
  productName: string;
  selectedVariantId: string;
  onVariantSelectedBySwipe: (variantId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isProgrammaticScrollRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const prevSelectedVariantId = useRef(selectedVariantId);

  // Variant changed via the <Select> (not via this carousel) — scroll to
  // that variant's first image, guarding the observer against reacting to
  // its own programmatic scroll.
  useEffect(() => {
    if (selectedVariantId === prevSelectedVariantId.current) return;
    prevSelectedVariantId.current = selectedVariantId;
    if (images.length <= 1) return;

    const targetIndex = images.findIndex((img) => img.variantId === selectedVariantId);
    if (targetIndex === -1) return; // no image for this variant — carousel stays put

    const target = slideRefs.current[targetIndex];
    const container = containerRef.current;
    if (!target || !container) return;

    isProgrammaticScrollRef.current = true;
    target.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });

    // TS narrows `window` itself to `never` in the else-branch of an
    // inline `"x" in window` check (it treats the property as always
    // present on the Window type) — checking a local boolean instead
    // avoids that.
    const supportsScrollEnd = "onscrollend" in window;
    if (supportsScrollEnd) {
      const handler = () => {
        isProgrammaticScrollRef.current = false;
        container.removeEventListener("scrollend", handler);
      };
      container.addEventListener("scrollend", handler);
      return () => container.removeEventListener("scrollend", handler);
    }
    const timeout = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [selectedVariantId, images]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || images.length <= 1) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScrollRef.current) return;
        const mostVisible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!mostVisible) return;
        const idx = slideRefs.current.findIndex((el) => el === mostVisible.target);
        if (idx === -1) return;
        setActiveIndex(idx);
        const img = images[idx];
        if (img.variantId && img.variantId !== prevSelectedVariantId.current) {
          prevSelectedVariantId.current = img.variantId;
          onVariantSelectedBySwipe(img.variantId);
        }
      },
      { root: container, threshold: 0.6 }
    );
    for (const el of slideRefs.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [images, onVariantSelectedBySwipe]);

  function scrollToIndex(idx: number) {
    slideRefs.current[idx]?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  if (images.length === 0) {
    return (
      <div className="relative aspect-square w-full bg-muted">
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Sin foto
        </div>
      </div>
    );
  }

  return (
    <div className="group relative aspect-square w-full bg-muted">
      <div
        ref={containerRef}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((img, i) => (
          <div
            key={`${img.url}-${i}`}
            ref={(el) => {
              slideRefs.current[i] = el;
            }}
            className="relative h-full w-full shrink-0 snap-start"
          >
            <Image
              src={img.url}
              alt={productName}
              fill
              sizes="(max-width: 640px) 50vw, 300px"
              className="object-cover"
              unoptimized
            />
          </div>
        ))}
      </div>

      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Foto anterior"
            className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100 disabled:invisible"
            disabled={activeIndex === 0}
            onClick={() => scrollToIndex(activeIndex - 1)}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Foto siguiente"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100 disabled:invisible"
            disabled={activeIndex === images.length - 1}
            onClick={() => scrollToIndex(activeIndex + 1)}
          >
            <ChevronRight className="size-4" />
          </button>
          <div className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 gap-1">
            {images.map((img, i) => (
              <button
                key={`${img.url}-${i}`}
                type="button"
                aria-label={`Ir a foto ${i + 1}`}
                onClick={() => scrollToIndex(i)}
                className={`size-1.5 rounded-full transition-colors ${
                  i === activeIndex ? "bg-foreground" : "bg-foreground/30"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
