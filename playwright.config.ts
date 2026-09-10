import { defineConfig, devices } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Playwright's own process doesn't get Next.js's env-file loading — load
// `.env.development.local` manually (same pattern as
// lib/wholesale-anon-access.integration.test.ts) so both this config and
// the specs can reach Supabase local for setup/cleanup queries.
const envPath = path.resolve(__dirname, ".env.development.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

// E2E contra Supabase LOCAL únicamente — nunca producción (decisión
// explícita de la usuaria, ver docs/testing.md § Entorno E2E). Requiere
// `supabase start` corriendo y `.env.development.local` con las
// credenciales locales que imprime ese comando (`next dev` las toma
// automáticamente, tienen prioridad sobre `.env.local`).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4400",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Next.js sólo permite una instancia de `next dev` por directorio de
  // proyecto — si ya tenés un `npm run dev -- --port 4400` corriendo
  // localmente (contra Supabase local, vía .env.development.local), este
  // webServer lo reutiliza en vez de fallar por instancia duplicada.
  webServer: {
    command: "npm run dev -- --port 4400",
    url: "http://localhost:4400",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
