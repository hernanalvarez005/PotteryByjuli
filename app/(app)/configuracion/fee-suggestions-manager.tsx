"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import {
  createFeeSuggestion,
  deleteFeeSuggestion,
  updateFeeSuggestionPercentage,
} from "./actions";

type Option = { id: string; name: string };
type FeeSuggestion = {
  id: string;
  payment_method_id: string;
  account_id: string | null;
  suggested_percentage: number;
};

export function FeeSuggestionsManager({
  suggestions,
  methods,
  accounts,
  canEdit,
}: {
  suggestions: FeeSuggestion[];
  methods: Option[];
  accounts: Option[];
  canEdit: boolean;
}) {
  const methodLabels = Object.fromEntries(methods.map((m) => [m.id, m.name]));
  const accountLabels = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  const [state, formAction, isPending] = useActionState(createFeeSuggestion, {});
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [accountId, setAccountId] = useState("");

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Comisión estimada que se muestra en la venta rápida antes de cobrar — nunca lo que
        efectivamente se guarda: eso lo confirma o corrige la usuaria en el momento del cobro.
        Una fila sin cuenta aplica como default genérico para ese método.
      </p>

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          {suggestions.map((s) => (
            <FeeSuggestionRow
              key={s.id}
              suggestion={s}
              methodName={methodLabels[s.payment_method_id] ?? "—"}
              accountName={s.account_id ? (accountLabels[s.account_id] ?? "—") : null}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}

      {canEdit && (
        <form action={formAction} className="flex flex-col gap-3 rounded-md border p-3">
          <p className="text-sm font-medium">Nueva sugerencia</p>
          <input type="hidden" name="payment_method_id" value={paymentMethodId} />
          <input type="hidden" name="account_id" value={accountId} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="fee_method_select">Método de pago *</Label>
              <Select
                items={methodLabels}
                value={paymentMethodId}
                onValueChange={(v) => v && setPaymentMethodId(v)}
              >
                <SelectTrigger id="fee_method_select" className="w-full">
                  <SelectValue placeholder="Elegir" />
                </SelectTrigger>
                <SelectContent>
                  {methods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fee_account_select">Cuenta</Label>
              <Select items={accountLabels} value={accountId} onValueChange={(v) => setAccountId(v ?? "")}>
                <SelectTrigger id="fee_account_select" className="w-full">
                  <SelectValue placeholder="(genérico)" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="suggested_percentage">Comisión sugerida (%)</Label>
            <Input
              id="suggested_percentage"
              name="suggested_percentage"
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="w-32"
              required
            />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <Button type="submit" disabled={isPending || !paymentMethodId} className="self-start">
            {isPending ? "Guardando..." : "Agregar"}
          </Button>
        </form>
      )}
    </div>
  );
}

function FeeSuggestionRow({
  suggestion,
  methodName,
  accountName,
  canEdit,
}: {
  suggestion: FeeSuggestion;
  methodName: string;
  accountName: string | null;
  canEdit: boolean;
}) {
  const [percentage, setPercentage] = useState(String(suggestion.suggested_percentage));
  const [isSaving, setIsSaving] = useState(false);

  async function commit() {
    const value = Number(percentage);
    if (!Number.isFinite(value) || value === suggestion.suggested_percentage) return;
    setIsSaving(true);
    try {
      await updateFeeSuggestionPercentage(suggestion.id, value);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{methodName}</p>
        <p className="text-xs text-muted-foreground">{accountName ?? "Genérico (cualquier cuenta)"}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={percentage}
          disabled={!canEdit || isSaving}
          onChange={(e) => setPercentage(e.target.value)}
          onBlur={commit}
          className="w-20 text-right"
        />
        <span className="text-sm text-muted-foreground">%</span>
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            onClick={() => deleteFeeSuggestion(suggestion.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
