import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkIntegrationEnv, REQUIRED_INTEGRATION_ENV } from "./integration-env";

// globalSetup de vitest.integration.config.mts: corre una vez antes de
// cualquier archivo. Si algo no está bien, LANZA — nunca deja que los tests
// se salteen en silencio.

const ENV_FILE = ".env.development.local";

/** Completa las variables que falten desde `.env.development.local` (la
 * base LOCAL). Nunca lee `.env.local` (apunta a producción). Las variables
 * ya exportadas en el shell tienen prioridad. */
function loadLocalEnvFile() {
  const envPath = path.resolve(process.cwd(), ENV_FILE);
  if (!existsSync(envPath)) return false;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
  return true;
}

export default async function setup() {
  const loadedFile = loadLocalEnvFile();
  const problems = checkIntegrationEnv(process.env);

  if (problems.length === 0) {
    // Que Supabase local realmente esté levantado: si no, cada test fallaría
    // con un error de red poco claro.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    try {
      await fetch(`${url}/auth/v1/health`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      problems.push(`no se pudo conectar a Supabase local en ${new URL(url).origin} — ¿corriste \`supabase start\`?`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      [
        "Tests de integración: entorno inválido (no se corre nada — nunca se saltean en silencio).",
        ...problems.map((p) => `  - ${p}`),
        "",
        `Variables requeridas: ${REQUIRED_INTEGRATION_ENV.join(", ")}.`,
        `Se leen del shell o de ${ENV_FILE} en la raíz del repo${loadedFile ? "" : " (no existe)"} — Supabase LOCAL.`,
        "En un git worktree ese archivo no se copia: copialo o exportalo desde el checkout principal.",
      ].join("\n")
    );
  }
}
