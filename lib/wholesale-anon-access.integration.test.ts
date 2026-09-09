import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Regression test for a real P0: the public wholesale catalog rendered
// empty for `anon` (any unauthenticated visitor) while working fine for a
// logged-in admin. Root cause was NOT the data, and NOT the obvious
// tables — it was `price_lists` having no anon SELECT policy at all,
// which silently broke a *different* policy (on `price_list_items`) that
// referenced it inside an EXISTS subquery. RLS applies to every table a
// policy touches, not just the one being queried.
//
// This test hits the real Supabase REST API with only the anon key —
// deliberately no session, no service role, exactly what a visitor's
// phone sees. It's an integration test against the live project (no
// dedicated Supabase test project exists yet — docs/testing.md), so it
// only runs when the anon key is actually available and never mutates
// anything.

function loadEnvLocal() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return; // already set (e.g. CI secret)
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY);

async function anonRequest(table: string, query: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON_KEY!, Authorization: `Bearer ${ANON_KEY}` },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

async function anonSelect(table: string, query: string): Promise<unknown[]> {
  const { ok, body } = await anonRequest(table, query);
  if (!ok) return [];
  return body as unknown[];
}

/** Any product currently marked public for wholesale — used to test
 * column-level access against a row anon can genuinely see. */
async function firstPublicWholesaleProductId(): Promise<string> {
  const rows = (await anonSelect("wholesale_product_rules", "select=product_id&is_public=eq.true&limit=1")) as {
    product_id: string;
  }[];
  if (rows.length === 0) {
    throw new Error(
      "No hay ningún producto marcado is_public=true en wholesale_product_rules — este test necesita al menos uno para poder correr."
    );
  }
  return rows[0].product_id;
}

describe.skipIf(!hasCredentials)("anon access to the public wholesale catalog", () => {
  beforeAll(() => {
    if (!hasCredentials) {
      console.warn(
        "Skipping wholesale anon-access integration test: NEXT_PUBLIC_SUPABASE_URL/ANON_KEY not available."
      );
    }
  });

  it("can read the 'wholesale' price list — this is the exact row the P0 bug hid", async () => {
    const rows = (await anonSelect("price_lists", "select=code&code=eq.wholesale")) as { code: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].code).toBe("wholesale");
  });

  it("cannot read the 'retail' price list — the fix must not open every list", async () => {
    const rows = await anonSelect("price_lists", "select=code&code=eq.retail");
    expect(rows).toHaveLength(0);
  });

  it("can read at least one priced item from the wholesale list end-to-end", async () => {
    // Same chain the public catalog actually depends on: a published,
    // public wholesale product with a real price. If this comes back
    // empty, the catalog will render empty too, regardless of what any
    // single table looks like in isolation.
    const publicRules = (await anonSelect("wholesale_product_rules", "select=product_id&is_public=eq.true")) as {
      product_id: string;
    }[];
    expect(publicRules.length).toBeGreaterThan(0);

    const priceListRows = (await anonSelect("price_lists", "select=id&code=eq.wholesale")) as { id: string }[];
    expect(priceListRows.length).toBeGreaterThan(0);

    const priced = await anonSelect(
      "price_list_items",
      `select=id,unit_price&price_list_id=eq.${priceListRows[0].id}`
    );
    expect(priced.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasCredentials)("anon cannot read internal data (sección 15)", () => {
  it("never sees customers", async () => {
    expect(await anonSelect("customers", "select=id")).toHaveLength(0);
  });

  it("never sees payments", async () => {
    expect(await anonSelect("payments", "select=id")).toHaveLength(0);
  });

  it("never sees orders", async () => {
    expect(await anonSelect("orders", "select=id")).toHaveLength(0);
  });

  it("never sees inventory movements", async () => {
    expect(await anonSelect("inventory_movements", "select=id")).toHaveLength(0);
  });

  it("is refused outright when asking for a product's cost_estimate — RLS only gates rows, column grants gate this", async () => {
    // A second, separate finding from the same audit: anon can read the
    // `products` row for a public wholesale product (that's the point of
    // the RLS policy), but that says nothing about which *columns* — a
    // client could always ask for cost_estimate directly regardless of
    // what lib/wholesale.ts itself selects, unless the grant is actually
    // scoped column-by-column. Must fail with 42501 (permission denied
    // for table products), not just come back empty/null.
    const { ok, status, body } = await anonRequest(
      "products",
      `select=id,cost_estimate&id=eq.${await firstPublicWholesaleProductId()}`
    );
    expect(ok).toBe(false);
    expect(status).toBe(401);
    expect((body as { code?: string })?.code).toBe("42501");
  });

  it("can still read the safe columns of that same product", async () => {
    const productId = await firstPublicWholesaleProductId();
    const rows = await anonSelect("products", `select=id,name,description&id=eq.${productId}`);
    expect(rows.length).toBeGreaterThan(0);
  });
});
