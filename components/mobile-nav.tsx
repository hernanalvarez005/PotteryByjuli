"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SidebarNav } from "@/components/sidebar-nav";

/**
 * Without this, the sidebar (hidden below `md`) leaves no way at all to
 * move between sections on a phone — sección 56 del brief: el backoffice
 * tiene que ser "completamente usable en mobile".
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
      >
        <Menu className="size-5" />
      </Button>
      <SheetContent side="left" className="max-h-dvh w-64 p-0">
        <SheetHeader className="shrink-0 border-b px-4 py-3">
          <SheetTitle className="text-left">Pottery</SheetTitle>
        </SheetHeader>
        {/* El header queda fijo arriba (shrink-0); esto es lo único que
            scrollea — sin overflow-y-auto acá, un menú con muchos ítems
            no tenía forma de desplazarse hasta el final en mobile
            (sección 27 de la tanda de usabilidad). */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <SidebarNav onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
