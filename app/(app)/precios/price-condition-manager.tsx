"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Plus } from "lucide-react";
import { createPriceCondition, setPriceConditionActive } from "./actions";

type PaymentMethod = { id: string; name: string };
type PriceCondition = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  methods: PaymentMethod[];
};

/**
 * Condiciones de precio (Bloque 3 — "Próxima evolución operativa"): cada
 * fila es su propia price_list dedicada (creada atómicamente por el RPC
 * create_price_condition), así que sus precios por variante se editan
 * con la misma grilla de siempre más abajo en esta página — acá sólo se
 * da de alta la condición y se elige qué métodos de pago acepta.
 */
export function PriceConditionManager({
  conditions,
  allMethods,
}: {
  conditions: PriceCondition[];
  allMethods: PaymentMethod[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">Condiciones de precio</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button type="button" size="sm" variant="outline" />}>
            <Plus className="size-4" />
            Nueva condición
          </DialogTrigger>
          <NewConditionDialogContent allMethods={allMethods} onCreated={() => setOpen(false)} />
        </Dialog>
      </CardHeader>
      <CardContent>
        {conditions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay condiciones de precio cargadas.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Métodos de pago</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conditions.map((c) => (
                <ConditionRow key={c.id} condition={c} />
              ))}
            </TableBody>
          </Table>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          El precio por variante de cada condición se edita como cualquier
          otra lista, en la grilla de abajo.
        </p>
      </CardContent>
    </Card>
  );
}

function ConditionRow({ condition }: { condition: PriceCondition }) {
  const [isPending, startTransition] = useTransition();

  return (
    <TableRow>
      <TableCell className="font-medium">{condition.name}</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {condition.methods.length > 0 ? condition.methods.map((m) => m.name).join(", ") : "—"}
      </TableCell>
      <TableCell>
        <Badge variant={condition.is_active ? "secondary" : "outline"}>
          {condition.is_active ? "Activa" : "Inactiva"}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() =>
            startTransition(() => setPriceConditionActive(condition.id, !condition.is_active))
          }
        >
          {condition.is_active ? "Desactivar" : "Activar"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function NewConditionDialogContent({
  allMethods,
  onCreated,
}: {
  allMethods: PaymentMethod[];
  onCreated: () => void;
}) {
  const [state, formAction, isPending] = useActionState(createPriceCondition, {});
  const [name, setName] = useState("");
  const [methodIds, setMethodIds] = useState<string[]>([]);

  // Mismo patrón que CustomerPickerDialogContent (ventas/nueva/quick-sale-form.tsx):
  // detectar "recién terminó de crear, sin error" comparando contra el
  // pending anterior, no el resultado en sí — useActionState nunca
  // "limpia" su propio resultado solo.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) {
      onCreated();
    }
    wasPending.current = isPending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, state.error]);

  function toggle(id: string, checked: boolean) {
    setMethodIds((prev) => (checked ? [...prev, id] : prev.filter((existing) => existing !== id)));
  }

  const methodSummary =
    methodIds.length === 0
      ? "Elegir métodos"
      : methodIds.length === 1
        ? (allMethods.find((m) => m.id === methodIds[0])?.name ?? "1 método")
        : `${methodIds.length} métodos`;

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nueva condición de precio</DialogTitle>
      </DialogHeader>
      <form action={formAction} className="flex flex-col gap-4">
        <div className="space-y-2">
          <Label htmlFor="condition_name">Nombre</Label>
          <Input
            id="condition_name"
            name="name"
            placeholder="3 cuotas sin interés"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Métodos de pago que acepta</Label>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="outline" className="w-full justify-between font-normal" />}
            >
              {methodSummary}
              <ChevronDown className="size-4 opacity-50" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {allMethods.map((m) => (
                <DropdownMenuCheckboxItem
                  key={m.id}
                  checked={methodIds.includes(m.id)}
                  onCheckedChange={(checked) => toggle(m.id, checked)}
                >
                  {m.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <input type="hidden" name="payment_method_ids" value={JSON.stringify(methodIds)} />
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <DialogFooter>
          <Button type="submit" disabled={isPending || !name.trim()}>
            {isPending ? "Creando..." : "Crear condición"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
