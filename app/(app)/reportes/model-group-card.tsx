"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MAX_SELECTED_MODELS, MODEL_SEARCH_MIN_CHARS } from "@/lib/report-view";
// Sólo TIPOS de lib/reports (que usa next/headers): un import de valor lo arrastraría al bundle del navegador.
import type { ReportModel, SelectionRow } from "@/lib/reports";
import { usePrivacyMode, maskCurrency } from "@/lib/privacy-mode";
import { searchModels } from "./actions";

/**
 * "¿Cuántas unidades vendí de estos modelos?": se eligen a mano varios modelos (productos) y se
 * muestra la cantidad vendida de cada uno y el total del grupo, con los mismos filtros de la página.
 * La selección vive en la URL (`?models=id,id`): se puede compartir, y la cuenta la hace el servidor
 * (`report_units_sold_selection`). Un modelo sin ventas en el período aparece con 0.
 */
export function ModelGroupCard({
  selected,
  rows,
  totalUnits,
  totalRevenue,
  periodLabel,
}: {
  selected: ReportModel[];
  rows: SelectionRow[];
  totalUnits: number;
  totalRevenue: number;
  periodLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isPrivate } = usePrivacyMode();
  const [query, setQuery] = useState("");
  // Resultado de la ÚLTIMA búsqueda terminada, con la consulta a la que corresponde (para no mostrar
  // "Sin resultados" ni resultados viejos mientras la búsqueda nueva todavía no volvió).
  const [found, setFound] = useState<{ q: string; models: ReportModel[] }>({ q: "", models: [] });
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const requestId = useRef(0);

  const selectedIds = selected.map((m) => m.id);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MODEL_SEARCH_MIN_CHARS) return; // sin búsqueda: la lista se oculta por `searching`
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const result = await searchModels(q);
      if (id !== requestId.current) return; // una búsqueda más nueva ya salió
      setFound({ q, models: result.models });
      setSearchError(result.error ?? null);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function setModels(ids: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (ids.length > 0) params.set("models", ids.join(","));
    else params.delete("models");
    startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  const atLimit = selectedIds.length >= MAX_SELECTED_MODELS;
  const searching = query.trim().length >= MODEL_SEARCH_MIN_CHARS;
  const answered = searching && found.q === query.trim();
  const visibleResults = answered ? found.models : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cantidad vendida por grupo de modelos</CardTitle>
        <p className="text-xs text-muted-foreground">
          Elegí varios modelos y mirá cuántas unidades se vendieron en total ({periodLabel}). Respeta los filtros de arriba.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="space-y-1">
          <Label htmlFor="model-search" className="text-xs text-muted-foreground">
            Agregar un modelo
          </Label>
          <Input
            id="model-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre (ej: taza)"
            autoComplete="off"
            disabled={atLimit}
          />
          {atLimit && <p className="text-xs text-muted-foreground">Llegaste al máximo de {MAX_SELECTED_MODELS} modelos.</p>}
          {searching && searchError && <p className="text-xs text-destructive">{searchError}</p>}
          {answered && !searchError && visibleResults.length === 0 && (
            <p className="text-xs text-muted-foreground">Sin resultados.</p>
          )}
          {visibleResults.length > 0 && (
            <ul className="mt-1 flex max-h-48 flex-col overflow-y-auto rounded-md border" aria-label="Resultados de la búsqueda">
              {visibleResults.map((m) => {
                const already = selectedIds.includes(m.id);
                return (
                  <li key={m.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      disabled={already || atLimit}
                      onClick={() => {
                        setModels([...selectedIds, m.id]);
                        setQuery("");
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>
                        {m.name}
                        {m.category && <span className="text-muted-foreground"> · {m.category}</span>}
                      </span>
                      {already ? <span className="text-xs text-muted-foreground">Ya agregado</span> : <Plus className="size-4" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selected.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2" aria-label="Modelos del grupo">
              {selected.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-1 text-xs">
                  {m.name}
                  <button
                    type="button"
                    aria-label={`Quitar ${m.name}`}
                    className="rounded-full p-0.5 hover:bg-background"
                    onClick={() => setModels(selectedIds.filter((id) => id !== m.id))}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setModels([])}>
                Limpiar grupo
              </Button>
            </div>

            <div className={isPending ? "opacity-60" : undefined}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Modelo</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead className="text-right">Facturación</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.variantId}>
                      <TableCell className="whitespace-normal">{r.label}</TableCell>
                      <TableCell className="text-right">{r.unitsSold}</TableCell>
                      <TableCell className="text-right">{maskCurrency(r.revenue, isPrivate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="whitespace-normal font-medium">Total del grupo ({selected.length} {selected.length === 1 ? "modelo" : "modelos"})</TableCell>
                    <TableCell className="text-right text-base font-semibold" data-testid="group-total-units">{totalUnits}</TableCell>
                    <TableCell className="text-right font-medium">{maskCurrency(totalRevenue, isPrivate)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
              <p className="mt-2 text-xs text-muted-foreground">
                Facturación = cantidad × precio, antes del descuento global del pedido. Un modelo sin ventas en el período figura con 0.
              </p>
            </div>
          </>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            Todavía no elegiste ningún modelo. Buscá arriba y agregá los que quieras sumar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
