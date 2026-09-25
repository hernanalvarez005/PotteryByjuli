// Compartir el PDF de un pedido mayorista con el cliente por WhatsApp
// (backoffice). Puro: sin Supabase ni React.
//
// Límites reales de la plataforma (por eso hay tres caminos, no uno):
//   1. `wa.me/<número>?text=` SÓLO lleva texto — nunca puede adjuntar un
//      archivo. Es el camino PRINCIPAL: apunta al número del cliente y
//      funciona en cualquier dispositivo, con un link firmado (72 h) al PDF
//      dentro del mensaje — el mismo criterio que ya usa el checkout público.
//   2. Web Share API con archivos (`navigator.share({ files })`) adjunta el
//      PDF de verdad, pero: sólo existe en algunos navegadores (móviles y
//      poco escritorio; se detecta con `canShare`), abre el selector del
//      sistema donde hay que ELEGIR el contacto (no apunta al número del
//      cliente) y algunas versiones de WhatsApp ignoran el texto cuando hay
//      archivo. Es una MEJORA móvil opcional, nunca la vía principal.
//   3. Escritorio sin Web Share: descargar el PDF y adjuntarlo a mano.

/** Vigencia del link firmado que va en el mensaje. */
export const SHARE_LINK_TTL_HOURS = 72;

export function buildWholesaleShareMessage(input: {
  customerFirstName: string | null | undefined;
  humanCode: string;
  /** Total ya formateado ("$ 160.000"). */
  totalLabel: string;
  /** Con link → mensaje para `wa.me`; sin link → mensaje que acompaña al PDF adjunto (Web Share). */
  documentUrl: string | null;
}): string {
  const name = input.customerFirstName?.trim();
  const greeting = name ? `Hola ${name}!` : "Hola!";
  const summary = `del pedido mayorista ${input.humanCode} por ${input.totalLabel}`;

  if (input.documentUrl) {
    return [
      `${greeting} Te comparto el detalle ${summary}.`,
      "",
      `Podés verlo y descargarlo acá (el link vence en ${SHARE_LINK_TTL_HOURS} horas): ${input.documentUrl}`,
      "",
      "Cualquier duda, escribime. ¡Gracias! — Pottery by Juli",
    ].join("\n");
  }
  return [
    `${greeting} Te adjunto el PDF con el detalle ${summary}.`,
    "",
    "Cualquier duda, escribime. ¡Gracias! — Pottery by Juli",
  ].join("\n");
}

/** Nombre de archivo del PDF compartido. */
export function wholesalePdfFileName(humanCode: string): string {
  return `${humanCode}.pdf`;
}

// Sólo lo que se usa de `Navigator` (así también se prueba con un objeto falso).
type NavigatorLike = { canShare?: (data: { files?: File[] }) => boolean; share?: unknown };

/**
 * ¿Este navegador puede compartir ESTE archivo? Nunca asume: sólo si
 * `share` y `canShare` existen y `canShare({ files })` responde que sí
 * (en escritorio normalmente no).
 */
export function canShareFile(nav: NavigatorLike | undefined, file: File): boolean {
  if (!nav || typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}
