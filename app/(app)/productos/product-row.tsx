"use client";

import { useTransition } from "react";
import Link from "next/link";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { toggleProductActive } from "./actions";

export function ProductRow({
  id,
  name,
  categoryName,
  variantCount,
  retailPrice,
  wholesalePrice,
  isActive,
  canEdit,
}: {
  id: string;
  name: string;
  categoryName: string | null;
  variantCount: number;
  retailPrice: number | null;
  wholesalePrice: number | null;
  isActive: boolean;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <TableRow>
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
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() =>
              startTransition(() => toggleProductActive(id, !isActive))
            }
          >
            {isActive ? "Desactivar" : "Activar"}
          </Button>
        </TableCell>
      )}
    </TableRow>
  );
}
