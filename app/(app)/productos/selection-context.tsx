"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type SelectionContextValue = {
  selected: Set<string>;
  toggle: (id: string) => void;
  clear: () => void;
  selectAll: (ids: string[]) => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

/** Shared checkbox-selection state for the bulk price adjustment tool
 * (sección 39-45) — a thin client-side layer over an otherwise
 * server-rendered products table, not a rewrite of it. */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const value = useMemo<SelectionContextValue>(
    () => ({
      selected,
      toggle: (id: string) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      clear: () => setSelected(new Set()),
      selectAll: (ids: string[]) =>
        setSelected((prev) => (prev.size === ids.length ? new Set() : new Set(ids))),
    }),
    [selected]
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection() {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used inside a SelectionProvider");
  return ctx;
}
