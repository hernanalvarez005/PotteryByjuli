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
import { deleteOrder } from "../actions";

/**
 * "Más acciones" de la ficha → "Eliminar pedido" (sólo owner). La regla de
 * elegibilidad NO vive acá: la decide `classify_order_for_delete` en
 * Postgres (`blockMessage` viene de ahí) y `delete_order_safe` la
 * re-verifica al borrar. Un pedido no elegible muestra POR QUÉ, sin botón
 * de borrar (se cancela desde el selector de estado).
 */
export function DeleteOrderMenu({
  orderId,
  humanCode,
  blockMessage,
}: {
  orderId: string;
  humanCode: string;
  /** null = se puede eliminar; texto = por qué no. */
  blockMessage: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteOrder(orderId, reason);
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
                  Esta acción eliminará el pedido cargado por error. No se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex flex-col gap-1.5 px-1">
                <Label htmlFor="delete-order-reason" className="text-xs text-muted-foreground">
                  Motivo (opcional)
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
              {error && <p className="px-1 text-sm text-destructive">{error}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPending}>Volver</AlertDialogCancel>
                <AlertDialogAction variant="destructive" disabled={isPending} onClick={(e) => { e.preventDefault(); confirmDelete(); }}>
                  {isPending ? "Eliminando..." : "Eliminar pedido"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
