"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import {
  PRODUCTION_ORIGIN_LABELS,
  PRODUCTION_STAGE_ORDER,
} from "@/schemas/production";
import type { ProductionOrderRow } from "@/lib/production-types";
import { productionItemLabel } from "@/lib/production-types";
import { advanceStage, cancelProductionOrder } from "./actions";
import { CompleteDialog } from "./complete-dialog";

const PRIORITY_VARIANT: Record<string, "outline" | "secondary" | "destructive"> = {
  low: "outline",
  normal: "outline",
  high: "destructive",
};

export function ProductionCard({ order, canEdit }: { order: ProductionOrderRow; canEdit: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isLastActiveStage =
    PRODUCTION_STAGE_ORDER.indexOf(order.status as (typeof PRODUCTION_STAGE_ORDER)[number]) ===
    PRODUCTION_STAGE_ORDER.length - 1;

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight">{productionItemLabel(order)}</p>
          {order.priority === "high" && (
            <Badge variant={PRIORITY_VARIANT[order.priority]}>Urgente</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {order.human_code} · {order.quantity} u. · {PRODUCTION_ORIGIN_LABELS[order.origin]}
        </p>
        {order.locations && (
          <p className="text-xs text-muted-foreground">{order.locations.name}</p>
        )}
        {order.target_date && (
          <p className="text-xs text-muted-foreground">Meta: {formatDate(order.target_date)}</p>
        )}
        {order.order_id && (
          <Link
            href={`/pedidos/${order.order_id}`}
            className="text-xs text-muted-foreground underline underline-offset-2"
          >
            Ver pedido
          </Link>
        )}

        {canEdit && (
          <div className="flex flex-col gap-1 pt-1">
            {isLastActiveStage ? (
              <CompleteDialog id={order.id} quantity={order.quantity} />
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    try {
                      await advanceStage(order.id, order.status);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Error");
                    }
                  })
                }
              >
                Avanzar etapa
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-xs text-muted-foreground"
              disabled={isPending}
              onClick={() => startTransition(() => cancelProductionOrder(order.id))}
            >
              Cancelar
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
