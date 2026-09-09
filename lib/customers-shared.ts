/**
 * Pure helpers with zero imports — safe from both Server Components
 * (lib/customers.ts re-exports these) and Client Components (roster
 * tables, registrant lists, ...) that need a WhatsApp button without
 * pulling in lib/supabase/server.ts (next/headers can't be bundled for
 * the browser — see the same split done for lib/production-types.ts).
 */
export function customerDisplayName(c: { first_name: string; last_name: string | null }) {
  return [c.first_name, c.last_name].filter(Boolean).join(" ");
}

/**
 * wa.me link with a best-effort normalized phone (digits only, AR country
 * code assumed if missing) and an optional prefilled message — sección 28:
 * "preparar una utilidad reusable... permitir opcionalmente phone, message".
 */
export function whatsappLink(rawPhone: string, message?: string): string {
  const digits = rawPhone.replace(/\D/g, "");
  const withCountryCode = digits.startsWith("54") ? digits : `54${digits}`;
  const base = `https://wa.me/${withCountryCode}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
