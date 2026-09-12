"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { todayInArgentina } from "@/lib/format";
import { BusinessUnitMultiSelect } from "./business-unit-multi-select";

const ALL_VALUE = "__all__";

type Option = { id: string; name: string };

/**
 * Filtros del dashboard — sección 8 de la tanda de mejoras operativas.
 * Genuinamente server-side: este componente sólo arma la URL
 * (searchParams), toda la query real vive en lib/reports.ts, corriendo
 * en el Server Component de page.tsx. Mismo patrón que /clientes?segment=
 * pero con varias dimensiones combinables a la vez.
 */
export function DashboardFilters({
  businessUnits,
  locations,
  channels,
  defaultFrom,
  defaultTo,
}: {
  businessUnits: Option[];
  locations: Option[];
  channels: Option[];
  /** El rango que el servidor efectivamente aplicó cuando la URL no trae
   * from/to — para que los inputs nunca muestren "vacío" mientras un
   * período sí está aplicado de verdad. */
  defaultFrom: string;
  defaultTo: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const from = searchParams.get("from") ?? defaultFrom;
  const to = searchParams.get("to") ?? defaultTo;
  const selectedUnitIds = (searchParams.get("business_units") ?? "").split(",").filter(Boolean);
  const location = searchParams.get("location") ?? ALL_VALUE;
  const channel = searchParams.get("channel") ?? ALL_VALUE;

  function pushParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value && value !== ALL_VALUE) params.set(key, value);
      else params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyPreset(preset: string) {
    const today = todayInArgentina();
    const [year, month] = today.split("-").map(Number);
    let newFrom = today;
    if (preset === "this_month") {
      newFrom = `${year}-${String(month).padStart(2, "0")}-01`;
    } else if (preset === "last_month") {
      const d = new Date(Date.UTC(year, month - 2, 1));
      newFrom = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
      pushParams({ from: newFrom, to: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` });
      return;
    } else if (preset === "last_30_days") {
      const d = new Date(Date.UTC(year, month - 1, Number(today.split("-")[2]) - 29));
      newFrom = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    } else if (preset === "this_year") {
      newFrom = `${year}-01-01`;
    }
    pushParams({ from: newFrom, to: today });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Período</Label>
        <Select
          items={{
            this_month: "Este mes",
            last_month: "Mes pasado",
            last_30_days: "Últimos 30 días",
            this_year: "Este año",
          }}
          value=""
          onValueChange={(v) => v && applyPreset(v)}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Preset" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="this_month">Este mes</SelectItem>
            <SelectItem value="last_month">Mes pasado</SelectItem>
            <SelectItem value="last_30_days">Últimos 30 días</SelectItem>
            <SelectItem value="this_year">Este año</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="from" className="text-xs text-muted-foreground">
          Desde
        </Label>
        <Input
          id="from"
          type="date"
          className="h-8 w-36 text-xs"
          value={from}
          max={to || undefined}
          onChange={(e) => pushParams({ from: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="to" className="text-xs text-muted-foreground">
          Hasta
        </Label>
        <Input
          id="to"
          type="date"
          className="h-8 w-36 text-xs"
          value={to}
          min={from || undefined}
          onChange={(e) => pushParams({ to: e.target.value })}
        />
      </div>

      <BusinessUnitMultiSelect
        options={businessUnits}
        selectedIds={selectedUnitIds}
        onChange={(ids) => pushParams({ business_units: ids.length > 0 ? ids.join(",") : null })}
      />
      <FilterSelect
        label="Ubicación"
        value={location}
        options={locations}
        onChange={(v) => pushParams({ location: v })}
      />
      <FilterSelect
        label="Canal"
        value={channel}
        options={channels}
        onChange={(v) => pushParams({ channel: v })}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  // Passed as Select's `items` prop so the trigger shows the translated
  // label immediately — without it, Base UI's <Select.Value> can't
  // resolve a label for a value that's already selected before the
  // popup has ever been opened (same root cause fixed in the bulk-price
  // dialog and the /mayorista product-card variant selector).
  const itemLabels = { [ALL_VALUE]: "Todas", ...Object.fromEntries(options.map((o) => [o.id, o.name])) };

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select items={itemLabels} value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>Todas</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
