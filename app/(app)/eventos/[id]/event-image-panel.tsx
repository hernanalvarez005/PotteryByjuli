"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { uploadEventImage } from "./actions";

export function EventImagePanel({
  eventId,
  imageUrl,
  canEdit,
}: {
  eventId: string;
  imageUrl: string | null;
  canEdit: boolean;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setIsUploading(true);

    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${eventId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("event-images")
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      await uploadEventImage(eventId, path);
    } catch {
      setError("No se pudo subir la imagen.");
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Imagen de portada</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {imageUrl ? (
          <div className="relative h-40 w-full overflow-hidden rounded-md border bg-muted">
            <Image src={imageUrl} alt="" fill sizes="400px" className="object-cover" unoptimized />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Todavía no hay imagen.</p>
        )}
        {canEdit && (
          <div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              disabled={isUploading}
              className="text-sm"
            />
            {isUploading && <p className="mt-1 text-xs text-muted-foreground">Subiendo...</p>}
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
