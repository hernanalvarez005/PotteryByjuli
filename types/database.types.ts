/**
 * Placeholder for Supabase's generated types.
 *
 * Once the project is linked to a real Supabase project, replace this file
 * by running:
 *
 *   npm run db:types
 *
 * (defined in package.json as `supabase gen types typescript --linked`).
 *
 * Until then, `Database` is loosely typed so the rest of the app can still
 * compile — every hand-written query should still narrow its own row shape
 * via the `schemas/` zod definitions.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = Record<string, unknown>;
