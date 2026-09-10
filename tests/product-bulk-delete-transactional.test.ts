import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Regression guard for the transactionality requirement on
// bulk_delete_products_safe (precisión de la usuaria en la tanda de
// mejoras operativas de productos): a Postgres function is already a
// single implicit transaction — the ONLY way that guarantee could break
// is if the per-id loop caught its own exceptions (`begin ... exception
// when others then ...`), which would let one failed product silently
// swallow its error while others already succeeded, leaving a partial
// result. This can't be exercised with a live integration test against
// the current schema (every real FK path from a product either cascades
// or is one of the three checks the function already makes — there's no
// "unanticipated blocker" to manufacture honestly), so instead this
// statically confirms the function body never adds that anti-pattern.
const MIGRATION_PATH = path.resolve(
  __dirname,
  "..",
  "supabase/migrations/20260910131110_product_safe_delete.sql"
);

describe("bulk_delete_products_safe stays a single atomic transaction", () => {
  it("the migration file exists where expected", () => {
    expect(() => readFileSync(MIGRATION_PATH, "utf-8")).not.toThrow();
  });

  it("never catches exceptions per-iteration inside the function body", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    const fnStart = sql.indexOf("create or replace function public.bulk_delete_products_safe");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = sql.indexOf("grant execute on function public.bulk_delete_products_safe", fnStart);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnBody = sql.slice(fnStart, fnEnd);

    // The anti-pattern that would break atomicity: a nested exception
    // handler around the per-id work, which would let one id's failure
    // be silently absorbed instead of aborting (and rolling back) the
    // whole call.
    expect(fnBody).not.toMatch(/exception\s+when\s+others/i);
  });
});
