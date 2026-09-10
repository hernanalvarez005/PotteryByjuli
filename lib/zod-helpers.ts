import { z } from "zod";

// Shared boundary helpers for form/DB data crossing into a zod schema.
//
// The bug these exist to prevent: `FormData.get("field")` returns `null`
// when a field is simply absent from the submitted form (not `""`, not
// `undefined`) — and a Supabase row for an optional column also comes
// back as `null`, never `undefined`. `z.string().optional()` only
// tolerates `undefined`; handed a bare `null` it fails with Zod's default
// "Invalid input: expected string, received null", which is exactly what
// happened to the wholesale checkout's `website` field (2026-09-10 P0):
// the schema and the Server Action both referenced it, but the actual
// form never rendered that input, so `formData.get("website")` was
// always `null`.
//
// These builders preprocess null/undefined/"" into a single normalized
// `undefined` *before* the base type check runs, so the field is
// genuinely optional regardless of which of those three shapes shows up
// — then transform back to `null` on the way out, matching this
// project's own convention (docs/business-rules.md: "" in forms, NULL in
// DB) instead of leaving `undefined` to leak into an insert.

/** An optional text field: null, undefined or "" all become `null`; a
 * real value is trimmed and length-capped. Never use this for a field
 * that's actually required — it will silently accept "no value". */
export function optionalString(max: number) {
  return z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.string().trim().max(max).optional()
  ).transform((v) => v ?? null);
}

/** A required text field: null or undefined are normalized to "" first, so
 * a missing value fails `inner`'s own `.min()` message (e.g. "Falta el
 * nombre.") instead of Zod's generic "Invalid input: expected string,
 * received null" — which `friendlyValidationMessage()` would otherwise not
 * recognize as one of our own messages and mask with a generic error.
 * Usage: `requiredString(z.string().trim().min(1, "Falta el nombre.").max(80))`. */
export function requiredString(inner: z.ZodString) {
  return z.preprocess((v) => (v === null || v === undefined ? "" : v), inner);
}

/** An optional UUID field: null, undefined or "" all become `null`. */
export function optionalUuid() {
  return z
    .preprocess(
      (v) => (v === null || v === undefined || v === "" ? undefined : v),
      z.string().trim().uuid().optional()
    )
    .transform((v) => v ?? null);
}

/** An optional integer field (form values arrive as strings). */
export function optionalInteger(min = 1) {
  return z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.string().trim().optional()
  )
    .transform((v) => (v === undefined ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= min), "Número inválido");
}

/** An optional money amount (form values arrive as strings). */
export function optionalMoneyAmount() {
  return z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.string().trim().optional()
  )
    .transform((v) => (v === undefined ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Importe inválido");
}
