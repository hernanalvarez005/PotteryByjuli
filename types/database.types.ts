/**
 * Placeholder for Supabase's generated types.
 *
 * `npm run db:types` currently fails on this machine: `supabase gen types
 * typescript --db-url ...` shells out to Docker for introspection, and
 * Docker isn't installed here. Options once that's needed for real:
 *   - install Docker Desktop/Podman and use `npm run db:types`, or
 *   - run `supabase login` + `supabase link` once, then
 *     `supabase gen types typescript --linked` (uses the Management API,
 *     no Docker required).
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
