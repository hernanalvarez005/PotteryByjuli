"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

const DEBOUNCE_MS = 350;

/**
 * Búsqueda server-side de /clientes (sección 19 de la tanda de
 * usabilidad) — combina con ?segment= y cualquier otro filtro existente,
 * nunca lo reemplaza: sólo agrega/actualiza ?q= en la misma URL. Debounce
 * razonable antes de navegar, así no dispara una consulta por cada tecla.
 */
export function CustomerSearchBar({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set("q", value.trim());
      } else {
        params.delete("q");
      }
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo debe re-debouncear cuando cambia lo que la usuaria tipeó, no en cada cambio de searchParams/router (evita un loop de re-debounce contra su propia navegación).
  }, [value]);

  return (
    <div className="relative max-w-sm">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Buscar por nombre, WhatsApp, email, CUIT..."
        className="pl-9"
      />
    </div>
  );
}
