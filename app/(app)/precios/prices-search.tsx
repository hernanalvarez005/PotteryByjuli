"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

const DEBOUNCE_MS = 300;

/**
 * Búsqueda server-side de /precios (perf audit H-08 bloque 5) — mismo
 * patrón que /productos/products-search.tsx: navega (nunca filtra en
 * memoria), lo que remonta PricesList (keyeada por `search` en
 * page.tsx) y reinicia su paginación.
 */
export function PricesSearch({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(next: string) {
    setValue(next);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      startTransition(() => {
        router.replace(next.trim() ? `/precios?q=${encodeURIComponent(next.trim())}` : "/precios");
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
