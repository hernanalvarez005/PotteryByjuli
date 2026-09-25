"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchWholesaleProducts, type PickableProduct } from "./featured-actions";

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
type Status = "idle" | "loading" | "success" | "error";

/**
 * Selector de productos de una sección destacada. Búsqueda server-side
 * (mismo motor de catálogo que /productos), nunca el catálogo entero, y
 * sólo productos habilitados para mayorista. Un error de backend nunca se
 * muestra como "sin resultados".
 */
export function FeaturedProductPicker({
  selectedIds,
  onAdd,
}: {
  selectedIds: Set<string>;
  onAdd: (product: PickableProduct) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<PickableProduct[]>([]);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const q = search.trim();
    if (q.length < MIN_CHARS) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("idle");
      setResults([]);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    const timeout = window.setTimeout(() => {
      searchWholesaleProducts(q)
        .then((outcome) => {
          if (cancelled) return;
          if ("error" in outcome) {
            setStatus("error");
            setResults([]);
          } else {
            setStatus("success");
            setResults(outcome.results);
          }
        })
        .catch(() => {
          if (cancelled) return;
          setStatus("error");
          setResults([]);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [search, retryKey]);

  const q = search.trim();

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar producto para agregar..."
        aria-label="Buscar producto para agregar"
      />
      {q.length > 0 && q.length < MIN_CHARS ? (
        <p className="px-1 text-xs text-muted-foreground">Escribí al menos {MIN_CHARS} caracteres.</p>
      ) : q.length >= MIN_CHARS ? (
        <div className="flex max-h-52 flex-col overflow-y-auto rounded-md border">
          {status === "loading" ? (
            <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Buscando...
            </p>
          ) : status === "error" ? (
            <div className="flex items-center justify-between gap-2 p-3 text-sm">
              <span className="flex items-center gap-2 text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                No se pudo buscar.
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => setRetryKey((k) => k + 1)}>
                Reintentar
              </Button>
            </div>
          ) : results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              Sin resultados entre los productos habilitados para mayorista.
            </p>
          ) : (
            results.map((p) => {
              const already = selectedIds.has(p.id);
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{p.name}</p>
                    {!p.hasWholesalePrice && (
                      <p className="text-xs text-amber-600">Sin precio mayorista — no se mostrará públicamente</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={already}
                    onClick={() => onAdd(p)}
                  >
                    {already ? (
                      "Agregado"
                    ) : (
                      <>
                        <Plus className="size-3.5" />
                        Agregar
                      </>
                    )}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
