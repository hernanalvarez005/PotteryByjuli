"use server";

import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { searchModels as searchModelsQuery, type ReportModel } from "@/lib/reports";

/** Buscador del selector de modelos de /reportes. Sólo owner/operations (como la página). */
export async function searchModels(query: string): Promise<{ models: ReportModel[]; error?: string }> {
  const user = await requireUser();
  if (!isOwner(user) && !hasRole(user, "operations")) return { models: [], error: "No tenés permiso para ver reportes." };
  if (typeof query !== "string" || query.length > 80) return { models: [] };
  try {
    return { models: await searchModelsQuery(query) };
  } catch {
    return { models: [], error: "No se pudo buscar. Probá de nuevo." };
  }
}
