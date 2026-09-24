import type { NextConfig } from "next";

// Fotos de producto (product-images) y de eventos/talleres (event-images)
// viven en Supabase Storage, servidas por getPublicUrl() bajo
// /storage/v1/object/public/<bucket>/... — sin esto, next/image rechaza
// cualquier host externo no listado (por eso estaba forzado `unoptimized`
// en cada <Image> que las mostraba). Toma el host de la misma env var que
// ya usa el cliente de Supabase, así que local (127.0.0.1:54321) y
// producción quedan cubiertos sin hardcodear ninguno de los dos acá
// (perf audit H-05A).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseHost = supabaseUrl ? new URL(supabaseUrl) : null;
// Next bloquea por SSRF cualquier host que resuelva a una IP privada,
// remotePatterns aparte — Supabase local (127.0.0.1) cae ahí. Sólo se
// relaja para ESE caso puntual (dev/test local), nunca en producción
// (el host de Supabase.co siempre es público, así que ahí esto no
// cambia nada — nunca se evalúa a true).
const isLocalSupabase = supabaseHost?.hostname === "127.0.0.1" || supabaseHost?.hostname === "localhost";

const nextConfig: NextConfig = {
  images: {
    dangerouslyAllowLocalIP: isLocalSupabase,
    remotePatterns: supabaseHost
      ? [
          {
            protocol: (supabaseHost.protocol.replace(":", "") as "http" | "https"),
            hostname: supabaseHost.hostname,
            port: supabaseHost.port,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
};

export default nextConfig;
