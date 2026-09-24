import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Tests de integración (`*.integration.test.ts`): corren contra Supabase
// LOCAL y modifican datos de verdad. Se separan de `npm test` (unit) y
// arrancan con un gate que falla fuerte si falta el entorno — ver
// tests/support/integration-global-setup.ts y docs/testing.md.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.integration.test.ts"],
    exclude: ["node_modules", ".next"],
    globalSetup: ["./tests/support/integration-global-setup.ts"],
  },
});
