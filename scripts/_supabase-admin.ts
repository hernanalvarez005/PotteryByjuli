// Service-role Supabase client for one-off, trusted, server-side scripts
// ONLY (scripts/import-*.ts). Deliberately not exported from lib/supabase/
// — nothing under app/ or lib/supabase/{client,server}.ts ever imports
// this file, so the service role key can never end up in a browser
// bundle. Run these scripts from a terminal you control, never from a
// deployed/serverless context. See docs/business-rules.md § Importación —
// seguridad.

import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL en el entorno (.env.local).");
  }
  if (!serviceKey) {
    throw new Error(
      "Falta SUPABASE_SERVICE_ROLE_KEY en el entorno. Este script necesita la " +
        "service_role key (Supabase Dashboard → Project Settings → API) para " +
        "leer/escribir sin pasar por RLS — nunca la uses en código de browser."
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
