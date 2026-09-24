import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Los tests de integración (Supabase local) tienen su propio config y
    // gate: `npm run test:integration` — ver vitest.integration.config.mts.
    exclude: ["node_modules", ".next", "**/*.integration.test.ts"],
  },
});
