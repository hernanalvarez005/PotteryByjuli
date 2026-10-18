"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/format";
import {
  canConfirmDelete,
  deleteConfirmationLabel,
  deleteConsequences,
  type DeleteInfo,
} from "@/lib/order-delete";
import { deleteOrder } from "../actions";

/**
 * "Más acciones" de la ficha → "Eliminar pedido" (sólo owner). La regla de
 * elegibilidad NO vive acá: la decide `classify_order_for_delete` en
 * Postgres (`blockMessage` viene de ahí) y `delete_order_safe` la
 * re-verifica al borrar. Un pedido no elegible muestra POR QUÉ, sin botón
 * de borrar (se cancela desde el selector de estado). Cuando la eliminación
 * tiene consecuencias (venta rápida, checkout de prueba) la UI muestra qué se
 * pierde y exige motivo, confirmación y tipear el código — lo mismo que
 * `delete_order_safe` vuelve a exigir en la base.
 */
export function DeleteOrderMenu({
  orderId,
  humanCode,
  blockMessage,
  info,
}: {
  orderId: string;
  humanCode: string;
  /** null = se puede eliminar; texto = por qué no. */
  blockMessage: string | null;
  /** Clasificación de un pedido eliminable (nivel, qué exige, qué se pierde). */
  info: DeleteInfo | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmCode, setConfirmCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const consequences = info ? deleteConsequences(info, formatCurrency) : [];
  const canConfirm = info ? canConfirmDelete(info, { reason, confirmed, confirmCode }, humanCode) : true;

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteOrder(orderId, reason, { confirmed, confirmCode });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/pedidos");
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Más acciones" />}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              setError(null);
              setReason("");
              setConfirmed(false);
              setConfirmCode("");
              setOpen(true);
            }}
          >
            <Trash2 className="size-4" />
            Eliminar pedido
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
        <AlertDialogContent>
          {blockMessage ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>No se puede eliminar {humanCode}</AlertDialogTitle>
                <AlertDialogDescription>{blockMessage}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Entendido</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Eliminar {humanCode}</AlertDialogTitle>
                <AlertDialogDescription>
                  {info?.level === "quick_sale"
                    ? "Esta acción elimina la venta rápida. No se puede deshacer."
                    : info?.level === "test_checkout"
                      ? "Esta acción elimina una solicitud del checkout ya cancelada y sin pagos, movimientos ni producción. No se puede deshacer."
                      : "Esta acción eliminará el pedido cargado por error. No se puede deshacer."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {consequences.length > 0 && (
                <ul className="flex list-disc flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-3 pl-7 text-sm text-amber-900">
                  {consequences.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-col gap-1.5 px-1">
                <Label htmlFor="delete-order-reason" className="text-xs text-muted-foreground">
                  {info?.requiresReason ? "Motivo (obligatorio)" : "Motivo (opcional)"}
                </Label>
                <Input
                  id="delete-order-reason"
                  value={reason}
                  maxLength={300}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ej: cargado dos veces"
                  disabled={isPending}
                />
              </div>
              {info?.requiresConfirmation && (
                <>
                  <label className="flex items-start gap-2 px-1 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      disabled={isPending}
                    />
                    <span>{deleteConfirmationLabel(info.level)}</span>
                  </label>
                  <div className="flex flex-col gap-1.5 px-1">
                    <Label htmlFor="delete-order-code" className="text-xs text-muted-foreground">
                      Para confirmar, escribí el código <span className="font-mono font-medium">{humanCode}</span>
                    </Label>
                    <Input
                      id="delete-order-code"
                      value={confirmCode}
                      onChange={(e) => setConfirmCode(e.target.value)}
                      autoComplete="off"
                      disabled={isPending}
                    />
                  </div>
                </>
              )}
              {error && <p className="px-1 text-sm text-destructive">{error}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPending}>Volver</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={isPending || !canConfirm}
                  onClick={(e) => {
                    e.preventDefault();
                    confirmDelete();
                  }}
                >
                  {isPending ? "Eliminando..." : "Eliminar"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
