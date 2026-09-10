import { describe, it, expect } from "vitest";
import { z } from "zod";
import { optionalString, optionalInteger, optionalMoneyAmount, requiredString } from "./zod-helpers";

// These builders exist specifically to prevent the 2026-09-09/10 wholesale
// checkout P0 ("Invalid input: expected string, received null") from
// recurring anywhere else: `FormData.get()` and a Supabase row both hand
// back a bare `null` for "no value", never `undefined`, and
// `z.string().optional()` alone only tolerates `undefined`.

describe("optionalString", () => {
  const schema = z.object({ field: optionalString(80) });

  it("accepts null, undefined and empty string as absent, normalizing to null", () => {
    expect(schema.safeParse({ field: null }).success).toBe(true);
    expect(schema.safeParse({ field: undefined }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ field: "" }).data?.field).toBeNull();
    expect(schema.safeParse({ field: null }).data?.field).toBeNull();
  });

  it("trims and keeps a real value", () => {
    expect(schema.safeParse({ field: "  hola  " }).data?.field).toBe("hola");
  });

  it("enforces the max length on a real value", () => {
    expect(schema.safeParse({ field: "a".repeat(81) }).success).toBe(false);
    expect(schema.safeParse({ field: "a".repeat(80) }).success).toBe(true);
  });
});

describe("optionalInteger", () => {
  const schema = z.object({ field: optionalInteger(1) });

  it("accepts null/undefined/empty as absent", () => {
    expect(schema.safeParse({ field: null }).data?.field).toBeNull();
    expect(schema.safeParse({ field: "" }).data?.field).toBeNull();
    expect(schema.safeParse({}).data?.field).toBeNull();
  });

  it("parses a numeric string", () => {
    expect(schema.safeParse({ field: "5" }).data?.field).toBe(5);
  });

  it("rejects a non-integer or below-minimum value", () => {
    expect(schema.safeParse({ field: "1.5" }).success).toBe(false);
    expect(schema.safeParse({ field: "0" }).success).toBe(false);
  });
});

describe("optionalMoneyAmount", () => {
  const schema = z.object({ field: optionalMoneyAmount() });

  it("accepts null/undefined/empty as absent", () => {
    expect(schema.safeParse({ field: null }).data?.field).toBeNull();
    expect(schema.safeParse({ field: "" }).data?.field).toBeNull();
  });

  it("parses a decimal amount", () => {
    expect(schema.safeParse({ field: "1250.50" }).data?.field).toBe(1250.5);
  });

  it("rejects a negative amount", () => {
    expect(schema.safeParse({ field: "-1" }).success).toBe(false);
  });
});

describe("requiredString", () => {
  const schema = z.object({
    field: requiredString(z.string().trim().min(1, "Falta el campo.").max(10)),
  });

  it("fails a bare null with the schema's own message, not Zod's generic one", () => {
    const result = schema.safeParse({ field: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Falta el campo.");
    }
  });

  it("fails undefined and empty string the same way", () => {
    expect(schema.safeParse({ field: undefined }).success).toBe(false);
    expect(schema.safeParse({ field: "" }).success).toBe(false);
  });

  it("accepts and trims a real value", () => {
    expect(schema.safeParse({ field: "  ok  " }).data?.field).toBe("ok");
  });
});
