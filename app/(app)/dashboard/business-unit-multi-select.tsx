"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

type Option = { id: string; name: string };

/**
 * Multi-select de unidades de negocio (secciones 31, 33, 35 de la tanda
 * de usabilidad) — checklist en un popover, nunca un <Select> tradicional
 * (sólo permite un valor). Ningún id seleccionado = "Todas" (sin filtro
 * por business_unit, nunca una lista hardcodeada).
 */
export function BusinessUnitMultiSelect({
  options,
  selectedIds,
  onChange,
}: {
  options: Option[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const summary =
    selectedIds.length === 0
      ? "Todas"
      : selectedIds.length === 1
        ? (options.find((o) => o.id === selectedIds[0])?.name ?? "1 unidad")
        : `${selectedIds.length} unidades`;

  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...selectedIds, id] : selectedIds.filter((existing) => existing !== id));
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">Unidad de negocio</Label>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" className="h-8 w-40 justify-between text-xs font-normal" />}
        >
          {summary}
          <ChevronDown className="size-3.5 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuCheckboxItem
            checked={selectedIds.length === 0}
            onCheckedChange={(checked) => {
              if (checked) onChange([]);
            }}
          >
            Todas
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.id}
              checked={selectedIds.includes(o.id)}
              onCheckedChange={(checked) => toggle(o.id, checked)}
            >
              {o.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
