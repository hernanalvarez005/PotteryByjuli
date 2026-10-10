"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/format";
import type { PaymentCorrectionEntry } from "@/lib/payment-corrections";
import { getPaymentHistory } from "@/app/(app)/pagos/actions";

/**
 * Historial de correcciones de un pago: qué cambió (antes → después), quién,
 * cuándo y el motivo. Se pide al servidor recién al abrirlo (no se arrastra
 * en cada fila de una lista de 200 pagos).
 */
export function PaymentHistory({ paymentId }: { paymentId: string }) {
  const [entries, setEntries] = useState<PaymentCorrectionEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPaymentHistory(paymentId)
      .then((rows) => !cancelled && setEntries(rows))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  if (failed) return <p className="text-xs text-destructive">No se pudo cargar el historial.</p>;
  if (!entries) return <p className="text-xs text-muted-foreground">Cargando historial…</p>;
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">Este pago nunca se corrigió.</p>;
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="payment-history">
      {entries.map((e) => (
        <li key={e.id} className="rounded-md bg-muted/50 p-2 text-xs">
          <p className="text-muted-foreground">
            {formatDateTime(e.changedAt)} · {e.changedByName ?? "usuario desconocido"}
          </p>
          <ul className="mt-1">
            {e.changes.map((c) => (
              <li key={c.field}>
                <span className="font-medium">{c.label}:</span> {c.from} → {c.to}
              </li>
            ))}
          </ul>
          {e.reason && <p className="mt-1 italic">Motivo: {e.reason}</p>}
        </li>
      ))}
    </ul>
  );
}
