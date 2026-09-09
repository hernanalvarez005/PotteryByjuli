"use client";

import { useSelection } from "./selection-context";

export function SelectAllCheckbox({ ids }: { ids: string[] }) {
  const { selected, selectAll } = useSelection();
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));

  return (
    <input
      type="checkbox"
      className="size-4 accent-primary"
      checked={allSelected}
      onChange={() => selectAll(ids)}
      aria-label="Seleccionar todos"
    />
  );
}
