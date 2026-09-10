"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Star, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  addProductImage,
  deleteProductImage,
  setPrimaryImage,
  setImageVariant,
  importProductImageFromUrl,
} from "./actions";

export type ProductImage = {
  id: string;
  storage_path: string;
  /** null = imagen general, no atada a un modelo particular. */
  variant_id: string | null;
  is_primary: boolean;
  publicUrl: string;
};

export type ImageVariant = { id: string; name: string };

const GENERAL_VALUE = "__general__";

export function ImagesPanel({
  productId,
  images,
  variants,
  canEdit,
}: {
  productId: string;
  images: ProductImage[];
  variants: ImageVariant[];
  canEdit: boolean;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // Compartido entre "subir archivo" y "pegar una URL" — a qué variante
  // (o General) se va a asociar la PRÓXIMA imagen que se agregue.
  const [uploadVariantId, setUploadVariantId] = useState<string>(GENERAL_VALUE);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setIsUploading(true);

    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${productId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(path, file, { contentType: file.type });

      if (uploadError) throw uploadError;

      await addProductImage(
        productId,
        path,
        images.length === 0,
        uploadVariantId === GENERAL_VALUE ? null : uploadVariantId
      );
    } catch {
      setError("No se pudo subir la imagen.");
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const variantNameById = new Map(variants.map((v) => [v.id, v.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Imágenes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {images.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay fotos.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {images.map((img) => (
              <div key={img.id} className="flex w-28 flex-col gap-1">
                <div className="relative w-28">
                  <div className="relative h-28 w-28 overflow-hidden rounded-md border bg-muted">
                    <Image
                      src={img.publicUrl}
                      alt=""
                      fill
                      sizes="112px"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  {img.is_primary && (
                    <Badge className="absolute left-1 top-1" variant="secondary">
                      Principal
                    </Badge>
                  )}
                  {canEdit && (
                    <div className="mt-1 flex justify-center gap-1">
                      {!img.is_primary && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Hacer principal"
                          onClick={() =>
                            startTransition(() => setPrimaryImage(productId, img.id))
                          }
                        >
                          <Star className="size-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        title="Borrar"
                        onClick={() =>
                          startTransition(() =>
                            deleteProductImage(productId, img.id, img.storage_path)
                          )
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                {canEdit && variants.length > 0 ? (
                  <Select
                    items={{
                      [GENERAL_VALUE]: "General",
                      ...Object.fromEntries(variants.map((v) => [v.id, v.name])),
                    }}
                    value={img.variant_id ?? GENERAL_VALUE}
                    onValueChange={(v) =>
                      v &&
                      startTransition(() =>
                        setImageVariant(productId, img.id, v === GENERAL_VALUE ? null : v)
                      )
                    }
                  >
                    <SelectTrigger className="h-7 w-full text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={GENERAL_VALUE}>General</SelectItem>
                      {variants.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-center text-[11px] text-muted-foreground">
                    {img.variant_id ? variantNameById.get(img.variant_id) ?? "General" : "General"}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {canEdit && (
          <div className="flex flex-col gap-3">
            {variants.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">
                  Asociar la próxima foto a
                </label>
                <Select
                  items={{
                    [GENERAL_VALUE]: "General",
                    ...Object.fromEntries(variants.map((v) => [v.id, v.name])),
                  }}
                  value={uploadVariantId}
                  onValueChange={(v) => v && setUploadVariantId(v)}
                >
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GENERAL_VALUE}>General</SelectItem>
                    {variants.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                disabled={isUploading}
                className="text-sm"
              />
              {isUploading && (
                <p className="mt-1 text-xs text-muted-foreground">Subiendo...</p>
              )}
              {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
            </div>
            <ImportFromUrl
              productId={productId}
              isFirst={images.length === 0}
              variantId={uploadVariantId === GENERAL_VALUE ? "" : uploadVariantId}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImportFromUrl({
  productId,
  isFirst,
  variantId,
}: {
  productId: string;
  isFirst: boolean;
  variantId: string;
}) {
  const boundAction = importProductImageFromUrl.bind(null, productId, isFirst);
  const [state, formAction, isPending] = useActionState(boundAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!isPending && !state.error) formRef.current?.reset();
  }, [isPending, state.error]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-1.5 border-t pt-3">
      <input type="hidden" name="variant_id" value={variantId} />
      <label className="text-xs text-muted-foreground" htmlFor="image_url">
        O pegar una URL pública (se descarga y se guarda en Storage propio — nunca queda linkeada a un sitio externo)
      </label>
      <div className="flex gap-2">
        <Input id="image_url" name="image_url" type="url" placeholder="https://..." disabled={isPending} required />
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Importando..." : "Importar imagen"}
        </Button>
      </div>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
