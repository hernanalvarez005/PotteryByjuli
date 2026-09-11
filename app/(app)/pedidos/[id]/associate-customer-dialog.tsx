"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { UserPlus } from "lucide-react";
import { associateOrderCustomer } from "../actions";
import { createCustomer } from "@/app/(app)/clientes/actions";

type Option = { id: string; name: string };

// Un pedido minorista rápido puede quedar sin cliente (a propósito — ver
// venta-rapida). Este diálogo cubre el "+ Asociar cliente" para agregarlo
// después: buscar uno existente, o crear uno nuevo sin salir del pedido.
export function AssociateCustomerDialog({ orderId, customers }: { orderId: string; customers: Option[] }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [customerId, setCustomerId] = useState("");
  const [isPending, startTransition] = useTransition();
  const [linkError, setLinkError] = useState<string | undefined>();

  const customerLabels = Object.fromEntries(customers.map((c) => [c.id, c.name]));

  const [createState, createFormAction, isCreating] = useActionState(createCustomer, {});
  const wasCreating = useRef(false);
  useEffect(() => {
    if (wasCreating.current && !isCreating && createState.customerId) {
      startTransition(async () => {
        try {
          await associateOrderCustomer(orderId, createState.customerId!);
          setOpen(false);
        } catch {
          setLinkError("El cliente se creó, pero no se pudo asociar al pedido.");
        }
      });
    }
    wasCreating.current = isCreating;
  }, [isCreating, createState.customerId, orderId]);

  function associateExisting() {
    setLinkError(undefined);
    startTransition(async () => {
      try {
        await associateOrderCustomer(orderId, customerId);
        setOpen(false);
      } catch {
        setLinkError("No se pudo asociar el cliente.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setCustomerId("");
          setMode("existing");
          setLinkError(undefined);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <UserPlus className="size-4" />
        Asociar cliente
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asociar cliente</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 text-sm">
          <button
            type="button"
            className={mode === "existing" ? "font-medium underline" : "text-muted-foreground"}
            onClick={() => setMode("existing")}
          >
            Buscar existente
          </button>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            className={mode === "new" ? "font-medium underline" : "text-muted-foreground"}
            onClick={() => setMode("new")}
          >
            Crear cliente
          </button>
        </div>

        {mode === "existing" ? (
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="associate_customer_id">Cliente</Label>
              <Select items={customerLabels} value={customerId} onValueChange={(v) => setCustomerId(v ?? "")}>
                <SelectTrigger id="associate_customer_id" className="w-full">
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
            {linkError && <p className="text-sm text-destructive">{linkError}</p>}
            <DialogFooter>
              <Button onClick={associateExisting} disabled={isPending || !customerId}>
                {isPending ? "Asociando..." : "Asociar"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={createFormAction} className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">Nombre</Label>
              <Input id="first_name" name="first_name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Apellido</Label>
              <Input id="last_name" name="last_name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="whatsapp">WhatsApp</Label>
              <Input id="whatsapp" name="whatsapp" />
            </div>
            {(createState.error || linkError) && (
              <p className="text-sm text-destructive">{createState.error ?? linkError}</p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={isCreating || isPending}>
                {isCreating || isPending ? "Creando..." : "Crear y asociar"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
