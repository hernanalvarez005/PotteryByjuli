"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { getWholesaleDocumentSignedUrl } from "./document-actions";

/**
 * Shows "Ver PDF" when the order already has a stored document (mints a
 * fresh short-lived signed URL on click and opens it), or a "Generar..."
 * button when it doesn't — never both. `generateAction` is injected so
 * this one component serves both document kinds stored in
 * `order_attachments` (wholesale_request_pdf via
 * generateWholesaleDocumentForOrder, order_summary_pdf via
 * generateOrderSummaryPdf) without duplicating this panel — sección 10
 * de la tanda de usabilidad: reusar la infraestructura, nunca duplicarla.
 */
export function DocumentPanel({
  orderId,
  storagePath,
  canEdit,
  generateAction,
  missingLabel = "No se generó el resumen PDF de esta solicitud (falló al momento del pedido).",
  generateLabel = "Generar resumen PDF",
  allowRegenerate = false,
}: {
  orderId: string;
  storagePath: string | null;
  canEdit: boolean;
  generateAction: (orderId: string) => Promise<{ error?: string }>;
  missingLabel?: string;
  generateLabel?: string;
  /** El PDF mayorista nunca se regenera desde acá a propósito — quedaría
   * reescribiendo "la solicitud original" (sección 30/42 del brief
   * original). El resumen de pedido sí puede: no es un documento legal
   * congelado, se actualiza cuando el pedido cambia (nuevo pago, ítem). */
  allowRegenerate?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (storagePath) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const url = await getWholesaleDocumentSignedUrl(storagePath);
              if (!url) {
                setError("No se pudo abrir el documento.");
                return;
              }
              window.open(url, "_blank", "noopener,noreferrer");
            });
          }}
        >
          {isPending ? "Abriendo..." : "Ver PDF"}
        </Button>
        {canEdit && allowRegenerate && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-xs font-normal text-muted-foreground"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await generateAction(orderId);
                if (result.error) setError(result.error);
              });
            }}
          >
            Regenerar
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  if (!canEdit) return <p className="text-sm text-muted-foreground">Sin documento.</p>;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{missingLabel}</p>
      <Button
        variant="outline"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await generateAction(orderId);
            if (result.error) setError(result.error);
          });
        }}
      >
        {isPending ? "Generando..." : generateLabel}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
