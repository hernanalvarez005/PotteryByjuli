"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { canShareFile } from "@/lib/wholesale-share";
import { prepareWholesaleShare, type WholesaleShareData } from "./document-actions";

/**
 * "Compartir con el cliente" — WhatsApp con mensaje + link firmado (camino
 * principal: funciona en cualquier dispositivo y apunta al número del
 * cliente), y mejoras/alternativas según lo que el navegador realmente
 * soporte (lib/wholesale-share.ts explica los límites de WhatsApp y Web
 * Share). Los links se piden al abrir el panel (un gesto de la usuaria) y
 * nunca antes: no se firma nada en cada vista de la ficha.
 */
export function ShareWholesalePanel({ orderId }: { orderId: string }) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<WholesaleShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Web Share con archivo: el File se baja ANTES del tap (compartir exige un
  // gesto reciente, y bajar el archivo después lo consumiría en algunos móviles).
  const [file, setFile] = useState<File | null>(null);

  function openPanel() {
    setOpen(true);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await prepareWholesaleShare(orderId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setData(result.data);
      // Sólo se intenta bajar el archivo si el navegador pudiera compartirlo.
      if (typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
        try {
          const response = await fetch(result.data.fileUrl);
          if (!response.ok) return;
          const candidate = new File([await response.blob()], result.data.fileName, { type: "application/pdf" });
          if (canShareFile(navigator, candidate)) setFile(candidate);
        } catch {
          // Sin Web Share: quedan WhatsApp con link y descarga.
        }
      }
    });
  }

  async function copyMessage() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.message);
      setNotice("Mensaje copiado.");
    } catch {
      setNotice("No se pudo copiar. Seleccionalo y copialo a mano.");
    }
  }

  function shareFile() {
    if (!data || !file) return;
    setNotice(null);
    // Sin await antes: navigator.share debe dispararse dentro del gesto.
    navigator
      .share({ files: [file], text: data.messageForFile, title: data.fileName })
      .catch((e: unknown) => {
        // Cancelar el selector no es un error.
        if (e instanceof DOMException && e.name === "AbortError") return;
        setNotice("No se pudo abrir el menú de compartir. Probá con WhatsApp o descargá el PDF.");
      });
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={openPanel}>
        Compartir con el cliente
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      {isPending && !data && <p className="text-muted-foreground">Preparando…</p>}
      {error && <p className="text-destructive">{error}</p>}
      {data && (
        <>
          {data.whatsappHref ? (
            <Button variant="default" size="sm" render={<a href={data.whatsappHref} target="_blank" rel="noopener noreferrer" />}>
              Abrir WhatsApp con mensaje y link al PDF
            </Button>
          ) : (
            <p className="text-muted-foreground">
              El cliente no tiene WhatsApp cargado. Copiá el mensaje y enviáselo por otro medio.
            </p>
          )}
          {file && (
            <Button variant="outline" size="sm" onClick={shareFile}>
              Compartir el PDF adjunto (elegís el contacto)
            </Button>
          )}
          {data.downloadUrl && (
            <Button variant="outline" size="sm" render={<a href={data.downloadUrl} />}>
              Descargar PDF
            </Button>
          )}
          <Button variant="ghost" size="sm" className="justify-start px-0 font-normal text-muted-foreground" onClick={copyMessage}>
            Copiar mensaje
          </Button>
          <p className="text-xs text-muted-foreground">
            WhatsApp no permite adjuntar el archivo desde un link: el mensaje lleva un enlace al PDF que vence en 72 horas.
            Para adjuntar el archivo directamente, en el celular usá &ldquo;Compartir el PDF adjunto&rdquo;; en la computadora,
            descargalo y adjuntalo en la conversación.
          </p>
          {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
        </>
      )}
    </div>
  );
}
