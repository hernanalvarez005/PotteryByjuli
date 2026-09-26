"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { DueWaiverHistoryItem } from "@/lib/workshop-dues";
import { WAIVED_BADGE_CLASS } from "@/lib/due-waiver-style";
import { waiveDue, unwaiveDue } from "./actions";

/**
 * Acciones de exención de la cuota base (sólo owner) — "Marcar como exenta" /
 * "Quitar exención". La regla (cuota cancelada, ya exenta, pagos existentes…)
 * vive en las RPC `waive_due` / `unwaive_due`; acá `hasPayments` sólo evita
 * ofrecer un diálogo que el servidor rechazaría.
 */
export function DueWaiverControls({
  groupId,
  dueId,
  customerName,
  periodLabel,
  baseWaived,
  hasPayments,
  cancelled,
}: {
  groupId: string;
  dueId: string;
  customerName: string;
  /** "Septiembre 2026" */
  periodLabel: string;
  baseWaived: boolean;
  hasPayments: boolean;
  cancelled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (cancelled) return null;

  const month = periodLabel.split(" ")[0]?.toLowerCase() ?? periodLabel;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = baseWaived ? await unwaiveDue(groupId, dueId, reason) : await waiveDue(groupId, dueId, reason);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setReason("");
    });
  }

  const blocked = !baseWaived && hasPayments;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setReason("");
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        {baseWaived ? "Quitar exención" : "Marcar como exenta"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{baseWaived ? `Quitar la exención de ${month}` : `Eximir cuota de ${month}`}</DialogTitle>
          <DialogDescription>
            {baseWaived
              ? `${customerName}: la cuota base vuelve a cobrarse. La exención queda en el historial.`
              : `${customerName}: se exime sólo la cuota base. Los extras siguen cobrándose. No se registra ningún pago ni ingreso.`}
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Esta cuota ya tiene pagos registrados. Resolvelo antes de eximirla.
          </p>
        ) : (
          <div className="space-y-2">
            <Label htmlFor={`waiver-reason-${dueId}`}>Motivo (opcional, recomendado)</Label>
            <Textarea
              id={`waiver-reason-${dueId}`}
              value={reason}
              maxLength={300}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
              placeholder={baseWaived ? "Ej: cargada por error" : "Ej: convenio, ausencia prolongada, cortesía"}
              disabled={isPending}
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" onClick={submit} disabled={isPending || blocked}>
            {isPending ? "Guardando..." : baseWaived ? "Quitar exención" : "Eximir cuota"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Historial de TODOS los ciclos de exención de una cuota (visible para todos los roles). */
export function DueWaiverHistory({ history, periodLabel }: { history: DueWaiverHistoryItem[]; periodLabel: string }) {
  if (history.length === 0) return null;
  return (
    <Dialog>
      <DialogTrigger render={<button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" />}>
        Historial de exención
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Exenciones — {periodLabel}</DialogTitle>
          <DialogDescription>Cada exención queda registrada; quitarla la cierra, no la borra.</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-3 text-sm">
          {history.map((w) => (
            <li key={w.id} className="flex flex-col gap-1 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">Exenta {formatCurrency(w.waivedAmount)}</span>
                <Badge variant="outline" className={w.active ? WAIVED_BADGE_CLASS : "text-muted-foreground"}>
                  {w.active ? "Activa" : "Quitada"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Eximida por {w.waivedByName ?? "—"} · {formatDateTime(w.waivedAt)}
              </p>
              {w.reason && <p>Motivo: {w.reason}</p>}
              {w.revertedAt && (
                <p className="text-xs text-muted-foreground">
                  Quitada por {w.revertedByName ?? "—"} · {formatDateTime(w.revertedAt)}
                  {w.revertReason ? ` — ${w.revertReason}` : ""}
                </p>
              )}
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
