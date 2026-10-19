import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Un componente cliente ("use client") NO puede importar VALORES de módulos que usan `next/headers`
// (lib/supabase/server, lib/auth, lib/reports, …): Next los arrastra al bundle del navegador y la
// página entera falla en el cliente con "You're importing a module that depends on next/headers".
// `tsc` y los tests de lógica no lo ven (un import de TIPO es seguro; uno de valor no). Regresión real
// al armar el selector de modelos de /reportes: importaba una constante de lib/reports.ts.

const ROOT = path.resolve(__dirname, "..");
const SERVER_ONLY = [/@\/lib\/supabase\/server/, /@\/lib\/auth(["'/])/, /@\/lib\/reports(["'])/, /@\/lib\/inventory(["'])/];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Imports de VALOR (los `import type` y los `{ type X }` solos no cuentan). */
function valueImports(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/^import\s+(?!type\b)([^;]*?)\s+from\s+["']([^"']+)["']/gm)) {
    const clause = m[1];
    const onlyTypes = /^\{[^}]*\}$/.test(clause.trim()) && clause.replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "));
    if (!onlyTypes) out.push(m[2]);
  }
  return out;
}

describe("componentes cliente sin imports de valores de servidor", () => {
  const clientFiles = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))].filter((f) =>
    /^\s*["']use client["']/.test(readFileSync(f, "utf-8").replace(/^(\s*\/\/.*\n|\s*\/\*[\s\S]*?\*\/\s*)*/, ""))
  );

  it("hay componentes cliente que revisar", () => {
    expect(clientFiles.length).toBeGreaterThan(10);
  });

  it("ninguno importa valores de lib/supabase/server, lib/auth, lib/reports ni lib/inventory", () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      for (const spec of valueImports(readFileSync(file, "utf-8"))) {
        if (SERVER_ONLY.some((re) => re.test(`${spec}"`))) offenders.push(`${path.relative(ROOT, file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("la detección funciona: un import de valor se marca y uno de tipo no", () => {
    expect(valueImports(`import { A } from "@/lib/reports";`)).toEqual(["@/lib/reports"]);
    expect(valueImports(`import type { A } from "@/lib/reports";`)).toEqual([]);
    expect(valueImports(`import { type A, type B } from "@/lib/reports";`)).toEqual([]);
    expect(valueImports(`import { A, type B } from "@/lib/reports";`)).toEqual(["@/lib/reports"]);
  });
});
