"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, Search } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { searchOrderVariants, MIN_SEARCH_CHARS, type OrderVariantResult } from "@/lib/product-search";
import { listPrice, PRICE_LIST_LABELS, type PriceListCode } from "@/lib/order-pricing";

const SEARCH_DEBOUNCE_MS = 250;
type SearchStatus = "idle" | "loading" | "success" | "error";

/**
 * Picker por fila de /pedidos/nuevo (perf audit H-08 bloque 5) — antes
 * renderizaba TODAS las variantes activas en un único <Select>, cargadas
 * enteras al abrir la página (mismo catálogo sin acotar que ya rompía en
 * /productos: hoy 3.352 productos activos, tope de 1.000 de PostgREST, y
 * la resolución de precios sobre esas 1.000 variantes ya da HTTP 414).
 * Reusa el motor de búsqueda de lib/product-search.ts (mismo que
 * /ventas/nueva, con `searchOrderVariants` que además trae el precio de
 * las dos listas) — nunca una segunda arquitectura de catálogo. Muestra el
 * precio de la lista vigente (`priceList`, según la unidad del pedido) o
 * "Sin precio" si esa lista no lo tiene: la variante igual se puede elegir. A diferencia de /ventas/nueva, acá no hay recientes/carrito:
 * es un selector puntual por fila, ya elegida la variante se cierra.
 */
export function VariantPicker({
  selectedLabel,
  priceList,
  onSelect,
}: {
  selectedLabel: string | null;
  priceList: PriceListCode;
  onSelect: (variant: OrderVariantResult) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [results, setResults] = useState<OrderVariantResult[]>([]);
  const [retryKey, setRetryKey] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = search.trim();
    if (q.length < MIN_SEARCH_CHARS) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("idle");
      setResults([]);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    const timeout = window.setTimeout(() => {
      searchOrderVariants(q).then((outcome) => {
        if (cancelled) return;
        if ("error" in outcome) {
          setStatus("error");
          setResults([]);
        } else {
          setStatus("success");
          setResults(outcome.results);
        }
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [search, retryKey]);

  function pick(variant: OrderVariantResult) {
    onSelect(variant);
    setSearch("");
    setStatus("idle");
    setResults([]);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm hover:bg-accent"
      >
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <span className={selectedLabel ? "truncate" : "truncate text-muted-foreground"}>
          {selectedLabel ?? "Buscar producto..."}
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onBlur={() => {
          // Un blur inmediato cerraría antes de poder click-ear un
          // resultado — se cierra sólo si no quedó nada tipeado, para no
          // dejar el picker abierto y vacío sin salida.
          if (!search.trim()) setOpen(false);
        }}
        placeholder="Buscar producto o variante..."
        className="h-9"
      />
      {search.trim().length > 0 && search.trim().length < MIN_SEARCH_CHARS ? (
        <p className="px-1 text-xs text-muted-foreground">Escribí al menos {MIN_SEARCH_CHARS} caracteres.</p>
      ) : search.trim().length >= MIN_SEARCH_CHARS ? (
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border">
          {status === "loading" ? (
            <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Buscando...
            </p>
          ) : status === "error" ? (
            <div className="flex items-center justify-between gap-2 p-2 text-xs">
              <span className="flex items-center gap-1 text-destructive">
                <AlertCircle className="size-3.5 shrink-0" />
                No se pudo buscar.
              </span>
              <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setRetryKey((k) => k + 1)}>
                Reintentar
              </Button>
            </div>
          ) : results.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">Sin resultados.</p>
          ) : (
            results.map((v) => (
              <button
                key={v.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(v)}
                className="flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                <span className="truncate">{v.label}</span>
                <span className="shrink-0 text-muted-foreground">
                  {listPrice(v.prices, priceList) != null
                    ? formatCurrency(listPrice(v.prices, priceList)!)
                    : `Sin precio ${PRICE_LIST_LABELS[priceList]}`}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
