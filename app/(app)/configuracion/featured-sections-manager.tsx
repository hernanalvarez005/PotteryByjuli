"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { formatDate } from "@/lib/format";
import { FEATURED_MIGRATION_PENDING_MESSAGE, type FeaturedSectionStatus } from "@/lib/wholesale-featured";
import { FeaturedSectionDialog } from "./featured-section-dialog";
import { deleteFeaturedSection, reorderFeaturedSections, setFeaturedSectionActive } from "./featured-actions";

export type FeaturedSectionAdminRow = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  /** Calculado en el server (no en el render del cliente). */
  status: FeaturedSectionStatus;
  products: { productId: string; name: string; hidden: boolean }[];
};

const STATUS_LABEL: Record<FeaturedSectionStatus, string> = {
  live: "Activa",
  scheduled: "Programada",
  expired: "Vencida",
  inactive: "Desactivada",
};

export function FeaturedSectionsManager({
  sections,
  canEdit,
  loadStatus,
  loadError,
}: {
  sections: FeaturedSectionAdminRow[];
  canEdit: boolean;
  /** "tables_missing" = migración sin aplicar; "error" = otro fallo al leer. Nunca se muestran como "no hay secciones". */
  loadStatus: "ok" | "tables_missing" | "error";
  loadError: string | null;
}) {
  const unavailable = loadStatus !== "ok";
  const [editing, setEditing] = useState<FeaturedSectionAdminRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<FeaturedSectionAdminRow | null>(null);
  const [isPending, startTransition] = useTransition();

  function openEditor(section: FeaturedSectionAdminRow | null) {
    setEditing(section);
    setDialogOpen(true);
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= sections.length) return;
    const ids = sections.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    startTransition(() => reorderFeaturedSections(ids));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium">Secciones destacadas</h3>
          <p className="text-sm text-muted-foreground">
            Agrupá productos para promocionarlos arriba del catálogo mayorista (por ejemplo, &ldquo;Día de la
            Madre&rdquo;). No cambia categorías, precios ni stock: un producto destacado sigue estando en el catálogo
            general, y un producto oculto en mayorista nunca aparece.
          </p>
        </div>
        {canEdit && !unavailable && (
          <Button size="sm" variant="outline" onClick={() => openEditor(null)}>
            <Plus className="size-4" />
            Nueva sección
          </Button>
        )}
      </div>

      {unavailable ? (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {loadStatus === "tables_missing"
            ? `${FEATURED_MIGRATION_PENDING_MESSAGE} Mientras tanto /mayorista se ve sin secciones destacadas.`
            : `No se pudieron cargar las secciones destacadas${loadError ? `: ${loadError}` : "."} /mayorista sigue funcionando, sin secciones.`}
        </p>
      ) : sections.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Todavía no creaste ninguna sección. /mayorista se ve sin secciones destacadas.
        </p>
      ) : (
        <ul className="flex flex-col rounded-md border">
          {sections.map((section, index) => {
            const hiddenCount = section.products.filter((p) => p.hidden).length;
            return (
              <li key={section.id} className="flex flex-wrap items-center gap-3 border-b px-3 py-3 last:border-b-0">
                {canEdit && (
                  <div className="flex flex-col">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      disabled={isPending || index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`Subir ${section.title}`}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      disabled={isPending || index === sections.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Bajar ${section.title}`}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{section.title}</p>
                    <Badge variant={section.status === "live" ? "secondary" : "outline"}>
                      {STATUS_LABEL[section.status]}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {section.products.length} producto{section.products.length === 1 ? "" : "s"}
                    {hiddenCount > 0 && (
                      <span className="text-amber-600">
                        {" "}
                        · {hiddenCount} oculto{hiddenCount === 1 ? "" : "s"} en mayorista
                      </span>
                    )}
                    {(section.starts_at || section.ends_at) && (
                      <>
                        {" · "}
                        {section.starts_at ? formatDate(section.starts_at) : "…"} →{" "}
                        {section.ends_at ? formatDate(section.ends_at) : "…"}
                      </>
                    )}
                  </p>
                </div>

                {canEdit && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openEditor(section)}>
                      <Pencil className="size-3.5" />
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => startTransition(() => setFeaturedSectionActive(section.id, !section.is_active))}
                    >
                      {section.is_active ? "Desactivar" : "Activar"}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-destructive"
                      onClick={() => setDeleting(section)}
                      aria-label={`Eliminar ${section.title}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <FeaturedSectionDialog
        key={editing?.id ?? "new"}
        section={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      <ConfirmAction
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={`¿Eliminar "${deleting?.title ?? ""}"?`}
        description="Se elimina la sección y sus asociaciones. Los productos NO se borran: siguen en el catálogo mayorista como siempre. Si sólo querés sacarla de /mayorista por un tiempo, desactivala en vez de eliminarla."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        onConfirm={async () => {
          if (deleting) await deleteFeaturedSection(deleting.id);
        }}
      />
    </div>
  );
}
