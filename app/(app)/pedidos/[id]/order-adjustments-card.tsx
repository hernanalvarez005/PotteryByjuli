import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { profileDisplayName } from "@/lib/workshop-dues";
import { STOCK_EFFECT_LABELS } from "@/lib/order-modification";

export type AdjustmentLine = {
  op: "add" | "set_quantity" | "remove";
  label: string;
  quantity_before: number;
  quantity_after: number;
  unit_price: number;
  stock?: string;
};

export type AdjustmentRow = {
  id: string;
  reason: string;
  after_delivery: boolean;
  total_before: number;
  total_after: number;
  created_at: string;
  changes: AdjustmentLine[];
  profiles: { full_name: string | null; email: string | null } | null;
};

function describe(line: AdjustmentLine): string {
  if (line.op === "add") return `+ ${line.quantity_after} × ${line.label} (${formatCurrency(line.unit_price)} c/u)`;
  if (line.op === "remove") return `− Se quitó ${line.quantity_before} × ${line.label}`;
  return `${line.label}: ${line.quantity_before} → ${line.quantity_after}`;
}

/** Historial de modificaciones del pedido (order_adjustments) — inmutable, visible para todos los roles. */
export function OrderAdjustmentsCard({ adjustments }: { adjustments: AdjustmentRow[] }) {
  if (adjustments.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Modificaciones del pedido</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3 text-sm">
          {adjustments.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 rounded-md border p-3" data-testid="order-adjustment">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {profileDisplayName(a.profiles)} · {formatDateTime(a.created_at)}
                </span>
                {a.after_delivery && (
                  <Badge variant="outline" className="border-amber-300 text-amber-700">
                    Posterior a la entrega
                  </Badge>
                )}
              </div>
              <ul className="flex flex-col gap-0.5">
                {a.changes.map((line, i) => (
                  <li key={i}>
                    {describe(line)}
                    {line.stock && STOCK_EFFECT_LABELS[line.stock] && (
                      <span className="text-xs text-muted-foreground"> · {STOCK_EFFECT_LABELS[line.stock]}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p>Motivo: {a.reason}</p>
              <p className="text-xs text-muted-foreground">
                Total {formatCurrency(a.total_before)} → {formatCurrency(a.total_after)}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
