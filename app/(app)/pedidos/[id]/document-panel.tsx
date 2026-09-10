"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { getWholesaleDocumentSignedUrl, generateWholesaleDocumentForOrder } from "./document-actions";

/**
 * Shows "Ver PDF" when the order already has a stored document (mints a
 * fresh short-lived signed URL on click and opens it), or "Generar resumen
 * PDF" when it doesn't (the original checkout-time generation failed) —
 * never both, and never a way to silently overwrite an existing document
 * (sección 30/42 del brief: eso quedaría como "solicitud original").
 */
export function DocumentPanel({
  orderId,
  storagePath,
  canEdit,
}: {
  orderId: string;
  storagePath: string | null;
  canEdit: boolean;
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
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  if (!canEdit) return <p className="text-sm text-muted-foreground">Sin documento.</p>;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        No se generó el resumen PDF de esta solicitud (falló al momento del pedido).
      </p>
      <Button
        variant="outline"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await generateWholesaleDocumentForOrder(orderId);
            if (result.error) setError(result.error);
          });
        }}
      >
        {isPending ? "Generando..." : "Generar resumen PDF"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
