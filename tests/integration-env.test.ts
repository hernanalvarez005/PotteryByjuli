import { describe, it, expect } from "vitest";
import { checkIntegrationEnv, isLocalSupabaseUrl } from "@/tests/support/integration-env";

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};

describe("gate de entorno de integración", () => {
  it("acepta un entorno local completo", () => {
    expect(checkIntegrationEnv(VALID)).toEqual([]);
    expect(checkIntegrationEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" })).toEqual([]);
  });

  it("nombra cada variable que falta", () => {
    const problems = checkIntegrationEnv({});
    expect(problems).toHaveLength(3);
    expect(problems.join("\n")).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(problems.join("\n")).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(problems.join("\n")).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(checkIntegrationEnv({ ...VALID, SUPABASE_SERVICE_ROLE_KEY: "" })).toEqual([
      "falta la variable SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it("rechaza una URL remota (producción) y no filtra la ruta ni credenciales en el mensaje", () => {
    const problems = checkIntegrationEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co/rest/v1?key=secreto" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no es local");
    expect(problems[0]).toContain("https://abcdefgh.supabase.co");
    expect(problems[0]).not.toContain("secreto");
  });

  it("no se deja engañar por hosts que sólo *contienen* localhost o 127.0.0.1", () => {
    expect(isLocalSupabaseUrl("https://localhost.evil.com")).toBe(false);
    expect(isLocalSupabaseUrl("https://abc.supabase.co/?host=localhost")).toBe(false);
    expect(isLocalSupabaseUrl("https://127.0.0.1.evil.com")).toBe(false);
    expect(isLocalSupabaseUrl("https://evil.com@abc.supabase.co/localhost")).toBe(false);
    expect(isLocalSupabaseUrl("no es una url")).toBe(false);
    expect(isLocalSupabaseUrl("ftp://127.0.0.1")).toBe(false);
  });
});
