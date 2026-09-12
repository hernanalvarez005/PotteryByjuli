import { redirect } from "next/navigation";

// La venta minorista rápida se mudó a /ventas/nueva (Bloque 2 — separación
// conceptual Ventas/Pedidos). Este redirect es sólo compatibilidad: un
// bookmark o un link viejo a esta URL no debe romperse.
export default function VentaRapidaRedirectPage() {
  redirect("/ventas/nueva");
}
