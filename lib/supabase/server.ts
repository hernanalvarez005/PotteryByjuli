import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Uses the public anon key + the caller's cookies, so every query still runs
 * under that user's RLS policies (never bypasses security).
 *
 * Not parameterized with `Database` yet — see the note in
 * lib/supabase/client.ts.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component with no request/response to
            // mutate — safe to ignore as long as middleware.ts is also
            // refreshing the session on every request.
          }
        },
      },
    }
  );
}
