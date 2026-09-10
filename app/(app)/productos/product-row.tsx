"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmAction } from "@/components/confirm-action";
import { formatCurrency } from "@/lib/format";
import { toggleProductActive, deleteProduct } from "./actions";
import { useSelection } from "./selection-context";

export function ProductRow({
  id,
  name,
  categoryName,
  variantCount,
  retailPrice,
  wholesalePrice,
  isActive,
  canEdit,
  canDelete,
}: {
  id: string;
  name: string;
  categoryName: string | null;
  variantCount: number;
  retailPrice: number | null;
  wholesalePrice: number | null;
  isActive: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const { selected, toggle } = useSelection();

  return (
    <TableRow>
      {canEdit && (
        <TableCell className="w-8">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={selected.has(id)}
            onChange={() => toggle(id)}
            aria-label={`Seleccionar ${name}`}
          />
        </TableCell>
      )}
      <TableCell>
        <Link href={`/productos/${id}`} className="font-medium hover:underline">
          {name}
        </Link>
        {variantCount > 1 && (
          <span className="ml-2 text-xs text-muted-foreground">
            {variantCount} variantes
          </span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{categoryName ?? "—"}</TableCell>
      <TableCell>{retailPrice != null ? formatCurrency(retailPrice) : "—"}</TableCell>
      <TableCell>{wholesalePrice != null ? formatCurrency(wholesalePrice) : "—"}</TableCell>
      <TableCell>
        <Badge variant={isActive ? "secondary" : "outline"}>
          {isActive ? "Activo" : "Inactivo"}
        </Badge>
      </TableCell>
      {canEdit && (
        <TableCell className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon" variant="ghost" className="size-8" />}>
              <MoreVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem render={<Link href={`/productos/${id}`} />}>Editar</DropdownMenuItem>
              <DropdownMenuItem
                disabled={isPending}
                onClick={() => startTransition(() => toggleProductActive(id, !isActive))}
              >
                {isActive ? "Desactivar" : "Activar"}
              </DropdownMenuItem>
              {canDelete && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={(e) => {
                    e.preventDefault();
                    setConfirmDeleteOpen(true);
                  }}
                >
                  Eliminar
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {canDelete && (
            <ConfirmAction
              open={confirmDeleteOpen}
              onOpenChange={setConfirmDeleteOpen}
              title={`¿Eliminar "${name}"?`}
              description="Sólo se puede si no tiene ventas, movimientos de stock ni órdenes de producción asociadas. Si tiene historial, se te va a avisar y podés desactivarlo en su lugar. Esta acción no se puede deshacer."
              confirmLabel="Eliminar"
              onConfirm={() => deleteProduct(id)}
            />
          )}
        </TableCell>
      )}
    </TableRow>
  );
}
