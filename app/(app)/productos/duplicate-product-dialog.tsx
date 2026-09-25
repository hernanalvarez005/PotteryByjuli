"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { suggestDuplicateName, validateDuplicateName, DUPLICATE_NAME_MAX } from "@/lib/duplicate-product";
import { duplicateProduct } from "./actions";

/**
 * Diálogo "Duplicar producto": pide un nombre nuevo (obligatorio, distinto
 * del original) y llama a la RPC transaccional. Al terminar redirige a la
 * ficha del producto nuevo para que Juli ajuste fotos/precios/colores.
 */
export function DuplicateProductDialog({
  productId,
  productName,
  open,
  onOpenChange,
}: {
  productId: string;
  productName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DuplicateForm productId={productId} productName={productName} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DuplicateForm({
  productId,
  productName,
  onCancel,
}: {
  productId: string;
  productName: string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(() => suggestDuplicateName(productName));
  const [publish, setPublish] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Tras un éxito seguimos "ocupados" hasta que la navegación termine: evita
  // un segundo submit (y una segunda copia) mientras se redirige.
  const [done, setDone] = useState(false);

  const validationError = validateDuplicateName(name, productName);
  const busy = isPending || done;

  function submit() {
    if (validationError || busy) return;
    setServerError(null);
    startTransition(async () => {
      const result = await duplicateProduct(productId, name, publish);
      if (result.error || !result.productId) {
        setServerError(result.error ?? "No se pudo duplicar el producto.");
        return;
      }
      setDone(true);
      router.push(`/productos/${result.productId}?duplicado=1`);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>Duplicar producto</DialogTitle>
        <DialogDescription>
          Se copiarán variantes, imágenes, precios y configuración del producto. El stock, las ventas y el
          historial no se duplicarán.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Producto original</p>
        <p className="text-sm font-medium">{productName}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="duplicate_name">Nuevo nombre *</Label>
        <Input
          id="duplicate_name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={DUPLICATE_NAME_MAX + 20}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          aria-invalid={validationError ? true : undefined}
        />
        {validationError && <p className="text-xs text-destructive">{validationError}</p>}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={publish}
          onChange={(e) => setPublish(e.target.checked)}
        />
        <span>
          Si el original está publicado en mayorista, publicar también la copia
          <span className="block text-xs text-muted-foreground">
            Por defecto la copia queda oculta en /mayorista: nace con las mismas fotos y precios que el original.
            Podés publicarla desde su ficha cuando esté lista.
          </span>
        </span>
      </label>

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" disabled={Boolean(validationError) || busy}>
          {busy ? "Duplicando..." : "Duplicar producto"}
        </Button>
      </DialogFooter>
    </form>
  );
}
