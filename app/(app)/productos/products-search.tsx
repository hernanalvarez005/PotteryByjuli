"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import type { ProductStatusFilter } from "@/lib/products";

const DEBOUNCE_MS = 300;

function buildProductsUrl(status: ProductStatusFilter, search: string) {
  const params = new URLSearchParams();
  if (status !== "active") params.set("estado", status);
  if (search.trim()) params.set("q", search.trim());
  const query = params.toString();
  return query ? `/productos?${query}` : "/productos";
}

/**
 * Búsqueda server-side de /productos (perf audit H-08 bloque 4) — navega
 * a una URL nueva (nunca filtra en memoria sobre un catálogo ya
 * descargado), lo que además reinicia la selección masiva al cambiar de
 * búsqueda "gratis": ProductsList se remonta porque page.tsx la key-ea
 * por `${status}:${search}` (mismo mecanismo que el filtro de estado).
 */
export function ProductsSearch({
  initialValue,
  status,
}: {
  initialValue: string;
  status: ProductStatusFilter;
}) {
  const [value, setValue] = useState(initialValue);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function handleChange(next: string) {
    setValue(next);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      startTransition(() => {
        router.replace(buildProductsUrl(status, next));
      });
    }, DEBOUNCE_MS);
  }

  return (
    <Input
      type="search"
      placeholder="Buscar producto por nombre..."
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      className="max-w-xs"
      aria-label="Buscar producto"
    />
  );
}
