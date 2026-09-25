"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DuplicateProductDialog } from "../duplicate-product-dialog";

/** Acción "Duplicar producto" en la ficha (misma que el menú de la lista). */
export function DuplicateProductButton({ productId, productName }: { productId: string; productName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Copy className="size-4" />
        Duplicar producto
      </Button>
      <DuplicateProductDialog productId={productId} productName={productName} open={open} onOpenChange={setOpen} />
    </>
  );
}
