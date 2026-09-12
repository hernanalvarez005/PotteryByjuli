"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMergePreview, mergeCustomers, type MergePreview, type MergeConflictField } from "../actions";

type Option = { id: string; name: string };

const FIELD_LABELS: Record<MergeConflictField, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  cuit: "CUIT",
  company_name: "Razón social",
};

const COUNT_LABELS: { key: keyof MergePreview["duplicateCounts"]; label: string }[] = [
  { key: "orders", label: "Pedidos" },
  { key: "payments", label: "Pagos" },
  { key: "enrollments", label: "Inscripciones" },
  { key: "dues", label: "Cuotas" },
  { key: "notes", label: "Notas" },
  { key: "eventRegistrations", label: "Otros vínculos" },
];

export function MergeCustomersForm({ customers }: { customers: Option[] }) {
  const router = useRouter();
  const [primaryId, setPrimaryId] = useState("");
  const [duplicateId, setDuplicateId] = useState("");
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [resolutions, setResolutions] = useState<Partial<Record<MergeConflictField, "primary" | "duplicate">>>({});
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  const customerLabels = Object.fromEntries(customers.map((c) => [c.id, c.name]));

  function handleCompare() {
    setError(undefined);
    startTransition(async () => {
      const result = await getMergePreview(primaryId, duplicateId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setPreview(result);
      setResolutions({});
    });
  }

  function handleConfirm() {
    if (!preview) return;
    setError(undefined);
    startTransition(async () => {
      const resolved: Partial<Record<MergeConflictField, string>> = { ...preview.autoFill };
      for (const field of preview.conflicts) {
        if (resolutions[field] === "duplicate") resolved[field] = preview.duplicate[field] ?? undefined;
      }
      const result = await mergeCustomers(preview.primary.id, preview.duplicate.id, resolved);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDone(true);
    });
  }

  if (done && preview) {
    return (
      <Card className="max-w-lg">
        <CardContent className="flex flex-col gap-3 py-8 text-center">
          <p className="text-lg font-medium">✓ Clientes fusionados</p>
          <p className="text-sm text-muted-foreground">
            {preview.duplicate.name} quedó archivado y fusionado en {preview.primary.name}.
          </p>
          <Button onClick={() => router.push(`/clientes/${preview.primary.id}`)} className="self-center">
            Ver ficha de {preview.primary.name}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const missingResolutions = preview?.conflicts.filter((f) => !resolutions[f]) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Elegir clientes</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="primary_select">Cliente principal (sobrevive)</Label>
            <Select items={customerLabels} value={primaryId} onValueChange={(v) => { setPrimaryId(v ?? ""); setPreview(null); }}>
              <SelectTrigger id="primary_select" className="w-full">
                <SelectValue placeholder="Elegir cliente" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="duplicate_select">Cliente duplicado (se archiva)</Label>
            <Select items={customerLabels} value={duplicateId} onValueChange={(v) => { setDuplicateId(v ?? ""); setPreview(null); }}>
              <SelectTrigger id="duplicate_select" className="w-full">
                <SelectValue placeholder="Elegir cliente" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error && <p className="max-w-2xl text-sm text-destructive">{error}</p>}

      {!preview && (
        <Button
          className="self-start"
          disabled={isPending || !primaryId || !duplicateId || primaryId === duplicateId}
          onClick={handleCompare}
        >
          {isPending ? "Comparando..." : "Comparar"}
        </Button>
      )}

      {preview && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">Qué va a migrarse de {preview.duplicate.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {COUNT_LABELS.map(({ key, label }) => (
                <li key={key} className="flex justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{preview.duplicateCounts[key]}</span>
                </li>
              ))}
            </ul>

            {Object.keys(preview.autoFill).length > 0 && (
              <p className="text-sm text-muted-foreground">
                Se va a completar en {preview.primary.name}:{" "}
                {(Object.entries(preview.autoFill) as [MergeConflictField, string][])
                  .map(([field, value]) => `${FIELD_LABELS[field]} (${value})`)
                  .join(", ")}
                .
              </p>
            )}

            {preview.conflicts.length > 0 && (
              <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
                <p className="text-sm font-medium">Elegí qué dato conservar</p>
                {preview.conflicts.map((field) => (
                  <div key={field} className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">{FIELD_LABELS[field]}</span>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`resolve-${field}`}
                        checked={resolutions[field] === "primary"}
                        onChange={() => setResolutions((prev) => ({ ...prev, [field]: "primary" }))}
                      />
                      {preview.primary[field]} ({preview.primary.name})
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`resolve-${field}`}
                        checked={resolutions[field] === "duplicate"}
                        onChange={() => setResolutions((prev) => ({ ...prev, [field]: "duplicate" }))}
                      />
                      {preview.duplicate[field]} ({preview.duplicate.name})
                    </label>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPreview(null)} disabled={isPending}>
                Volver
              </Button>
              <Button onClick={handleConfirm} disabled={isPending || missingResolutions.length > 0}>
                {isPending ? "Fusionando..." : "Confirmar fusión"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
