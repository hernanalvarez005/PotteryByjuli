"use client";

import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePrivacyMode } from "@/lib/privacy-mode";

/** Ícono de ojo del header — activa/desactiva el modo privado para todo
 * lo que se enmascare con maskCurrency, en cualquier pantalla. */
export function PrivacyToggle() {
  const { isPrivate, toggle } = usePrivacyMode();
  const label = isPrivate ? "Mostrar importes" : "Ocultar importes";

  return (
    <Button size="icon" variant="ghost" onClick={toggle} aria-label={label} title={label}>
      {isPrivate ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </Button>
  );
}
