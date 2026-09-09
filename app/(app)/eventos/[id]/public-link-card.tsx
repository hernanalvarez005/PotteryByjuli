"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Check, ExternalLink } from "lucide-react";

export function PublicLinkCard({ slug, isPublic }: { slug: string | null; isPublic: boolean }) {
  const [copied, setCopied] = useState(false);

  if (!slug) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Link público</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Definí un link (slug) en los datos del evento para poder compartirlo.
        </CardContent>
      </Card>
    );
  }

  const url = typeof window !== "undefined" ? `${window.location.origin}/workshops/${slug}` : `/workshops/${slug}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Link público</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!isPublic && (
          <p className="text-xs text-amber-600">
            Todavía no está publicado — nadie puede ver esta página hasta que cambies el estado a
            &quot;Publicado&quot;.
          </p>
        )}
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border bg-muted px-2 py-1.5 text-xs">{url}</code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
          {isPublic && (
            <a href={url} target="_blank" rel="noopener noreferrer">
              <Button size="icon" variant="ghost">
                <ExternalLink className="size-4" />
              </Button>
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
