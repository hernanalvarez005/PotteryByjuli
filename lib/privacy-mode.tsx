"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";

// Privacy mode (Bloque 8 — "Próxima evolución operativa", el más
// liviano de los 8): nunca un rol nuevo, sólo una preferencia de
// localStorage por dispositivo. Server Components no pueden leer
// localStorage, así que el estado real vive acá — en un Client
// Component que envuelve el layout — y cada KPI/gráfico que necesita
// enmascararse lo consume con usePrivacyMode() y formatea con
// maskCurrency, el "formateador compartido" que pide el diseño. Nunca
// un formateador propio por chart: ese es exactamente el riesgo que el
// diseño marcó ("tooltips de gráficos con su propio formateador").

const STORAGE_KEY = "pottery.privacyMode";

type PrivacyContextValue = { isPrivate: boolean; toggle: () => void };

const PrivacyContext = createContext<PrivacyContextValue>({ isPrivate: false, toggle: () => {} });

export function PrivacyModeProvider({ children }: { children: React.ReactNode }) {
  const [isPrivate, setIsPrivate] = useState(false);

  useEffect(() => {
    // Leer localStorage sólo puede pasar después del montaje (no hay
    // `window` durante SSR) — mismo patrón ya usado en quick-sale-form.tsx
    // para "última ubicación usada".
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsPrivate(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // localStorage no disponible (modo privado del navegador, etc.) —
      // el modo privado simplemente no persiste, nunca rompe la página.
    }
  }, []);

  const toggle = useCallback(() => {
    setIsPrivate((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return <PrivacyContext.Provider value={{ isPrivate, toggle }}>{children}</PrivacyContext.Provider>;
}

export function usePrivacyMode() {
  return useContext(PrivacyContext);
}

/** El formateador compartido: mismo `formatCurrency` de siempre, o el
 * importe enmascarado — nunca una fórmula distinta que se pueda
 * desincronizar del real. */
export function maskCurrency(amount: number, isPrivate: boolean): string {
  return isPrivate ? "$ ••••••" : formatCurrency(amount);
}
