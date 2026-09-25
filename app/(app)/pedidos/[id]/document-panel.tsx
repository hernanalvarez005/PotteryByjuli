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
  missingLabel = "No se generó el PDF de esta solicitud.",
  generateLabel = "Generar resumen PDF",
  regenerateLabel = "Regenerar",
  allowRegenerate = false,
  regenerateHint,
}: {
  orderId: string;
  storagePath: string | null;
  canEdit: boolean;
  generateAction: (orderId: string) => Promise<{ error?: string }>;
  missingLabel?: string;
  generateLabel?: string;
  regenerateLabel?: string;
  /** Mostrar "Regenerar" cuando ya hay PDF. Es seguro repetirlo: el PDF
   * mayorista se arma sólo con datos congelados en el pedido (misma
   * solicitud original) y la regeneración reusa el mismo archivo y la
   * misma fila — nunca duplica. El resumen de pedido también puede: se
   * actualiza cuando el pedido cambia (nuevo pago, ítem). */
  allowRegenerate?: boolean;
  /** Aclaración bajo "Regenerar" (p. ej. de dónde salen los datos). */
  regenerateHint?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
              setNotice(null);
              startTransition(async () => {
                const result = await generateAction(orderId);
                if (result.error) setError(result.error);
                else setNotice("PDF regenerado.");
              });
            }}
          >
            {isPending ? "Regenerando..." : regenerateLabel}
          </Button>
        )}
        {canEdit && allowRegenerate && regenerateHint && <p className="text-xs text-muted-foreground">{regenerateHint}</p>}
        {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
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
