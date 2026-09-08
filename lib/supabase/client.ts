import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in Client Components ("use client").
 * Uses the public anon key only — never the service role key.
 *
 * Not parameterized with `Database` yet: the real schema types don't exist
 * until `npm run db:types` is run against a linked project (see
 * types/database.types.ts). Until then, queries are validated at the
 * application boundary by the zod schemas in `schemas/`.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
