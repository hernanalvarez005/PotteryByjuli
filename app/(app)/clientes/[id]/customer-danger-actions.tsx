"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { toggleCustomerActive, deleteCustomer } from "../actions";

export function CustomerDangerActions({
  customerId,
  isActive,
  canArchive,
  canDelete,
}: {
  customerId: string;
  isActive: boolean;
  canArchive: boolean;
  canDelete: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canArchive && !canDelete) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {canArchive && (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                try {
                  await toggleCustomerActive(customerId, !isActive);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "No se pudo actualizar.");
                }
              })
            }
          >
            {isActive ? "Archivar" : "Reactivar"}
          </Button>
        )}
        {canDelete && (
          <ConfirmAction
            trigger={<Button size="sm" variant="outline" className="text-destructive" />}
            title="¿Eliminar este cliente?"
            description="Sólo se puede si no tiene pedidos, inscripciones a talleres ni a eventos. Esta acción no se puede deshacer."
            confirmLabel="Eliminar"
            onConfirm={() => deleteCustomer(customerId)}
          >
            Eliminar
          </ConfirmAction>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
