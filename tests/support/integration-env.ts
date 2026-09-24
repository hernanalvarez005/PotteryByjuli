// Gate de entorno de los tests de integración. Puro (recibe `env`) para que
// se pueda testear sin tocar process.env.
//
// Los tests de integración crean y borran datos de verdad, así que corren
// SÓLO contra Supabase LOCAL. Antes cada archivo hacía
// `describe.skipIf(!hasCredentials)`, y un `npm test` sin variables los
// salteaba en silencio y daba verde sin haber probado nada. Este gate hace
// que `npm run test:integration` falle fuerte en vez de saltear.

export const REQUIRED_INTEGRATION_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Local de verdad: se parsea la URL y se compara el hostname exacto (un
 * `.includes("localhost")` aceptaría `https://localhost.evil.com` o
 * `https://x.supabase.co/?localhost`). */
export function isLocalSupabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && LOCAL_HOSTNAMES.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Devuelve la lista de problemas (vacía = el entorno sirve). */
export function checkIntegrationEnv(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  for (const name of REQUIRED_INTEGRATION_ENV) {
    if (!env[name]) problems.push(`falta la variable ${name}`);
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (url && !isLocalSupabaseUrl(url)) {
    problems.push(
      `NEXT_PUBLIC_SUPABASE_URL no es local (${redactUrl(url)}) — los tests de integración crean y borran datos y NUNCA corren contra un Supabase remoto`
    );
  }
  return problems;
}

function redactUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "URL inválida";
  }
}
