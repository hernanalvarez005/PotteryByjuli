// Duplicar producto — reglas del nombre, compartidas por el diálogo (feedback
// inmediato) y la Server Action (defensa real). La RPC duplicate_product
// vuelve a validar lo mismo: nunca se confía sólo en el cliente.

export const DUPLICATE_NAME_MAX = 120;

/** `null` si el nombre es válido; si no, el mensaje para mostrar. */
export function validateDuplicateName(newName: string, sourceName: string): string | null {
  const name = newName.trim();
  if (name.length === 0) return "Ingresá un nombre para el producto nuevo.";
  if (name.length > DUPLICATE_NAME_MAX) return `El nombre es muy largo (máx. ${DUPLICATE_NAME_MAX}).`;
  if (name === sourceName.trim()) return "El nombre tiene que ser distinto del original.";
  return null;
}

/** Sugerencia inicial: "{nombre actual} - copia". */
export function suggestDuplicateName(sourceName: string): string {
  return `${sourceName.trim()} - copia`;
}
