import { parsePhoneNumberWithError, type CountryCode } from "libphonenumber-js/max";

// Server-only phone normalization for the wholesale checkout's WhatsApp
// field. Uses the "/max" metadata build (heavier than the default) because
// it's the only one that exposes `getType()` — needed for the Argentina
// mobile-marker fix below. Never import this from a "use client" file; it
// belongs in a Server Action, same trust boundary as the rest of the
// checkout's server-side logic.
//
// This does NOT replace `lib/customers-shared.ts`'s `whatsappLink()` — that
// helper stays untouched and keeps building wa.me links for every other
// flow (CRM, workshops) from whatever is already stored in
// `customers.whatsapp`. This module only produces the value that gets
// stored there in the first place, for the wholesale checkout path.

export type NormalizedPhone = {
  /** Digits only, country code first, no "+" — same shape the rest of the
   * app already stores in `customers.whatsapp` (see `whatsappLink`), so
   * dedup matching against existing rows keeps working unchanged. */
  canonical: string;
  /** Human-friendly international format for display in the UI/PDF. */
  display: string;
  isValid: boolean;
};

/**
 * Normalizes a phone number for storage/dedup in the wholesale checkout.
 *
 * Argentina-specific fix: a WhatsApp number given as plain 10 digits
 * ("11 2233-4455", no leading "9") parses as a FIXED_LINE per the official
 * numbering plan — but nobody actually says the "9" out loud, and WhatsApp
 * itself requires it in the number. Since this field's entire purpose is
 * "how do we reach you on WhatsApp", an AR number that resolves as
 * FIXED_LINE (or the ambiguous FIXED_LINE_OR_MOBILE) is deliberately
 * corrected to the mobile form here — a landline can't receive WhatsApp
 * messages anyway, so treating an ambiguous AR entry as mobile is virtually
 * always what the buyer meant. This nudge is intentionally AR-only: other
 * countries' numbers are trusted as-is (never assume every buyer is
 * Argentine — sección 5 del brief).
 *
 * Never throws — a malformed or unparseable input comes back as
 * `{ isValid: false }` with best-effort `canonical`/`display` values, so a
 * bad phone can still flow through dedup matching without crashing the
 * checkout (the required-field check that a WhatsApp was entered at all is
 * the schema's job, not this function's).
 */
export function normalizePhoneForStorage(
  raw: string,
  defaultCountry: CountryCode = "AR"
): NormalizedPhone {
  const trimmed = raw.trim();

  try {
    let parsed = parsePhoneNumberWithError(trimmed, defaultCountry);

    if (parsed.country === "AR") {
      const type = parsed.getType();
      const nationalDigits = parsed.nationalNumber; // never includes the "9" marker
      if ((type === "FIXED_LINE" || type === "FIXED_LINE_OR_MOBILE") && !nationalDigits.startsWith("9")) {
        // Re-parse as the mobile form so `display`/`isValid` reflect the
        // corrected number too, not just `canonical`.
        parsed = parsePhoneNumberWithError(`+549${nationalDigits}`);
      }
    }

    return {
      canonical: parsed.number.replace(/^\+/, ""),
      display: parsed.formatInternational(),
      isValid: parsed.isValid(),
    };
  } catch {
    // Not parseable at all (letters, empty, wildly malformed). Fall back to
    // a digits-only best-effort value so downstream code has *something*
    // consistent to compare/store — never throw out of a normalizer.
    const digits = trimmed.replace(/\D/g, "");
    return { canonical: digits, display: trimmed, isValid: false };
  }
}
