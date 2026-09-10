import { describe, it, expect } from "vitest";
import { wholesaleRequestFormSchema } from "./wholesale";

const validInput = {
  first_name: "Juli",
  last_name: "",
  company_name: "",
  cuit: "",
  instagram: "",
  website: "",
  city: "",
  province: "",
  whatsapp: "1123456789",
  email: "",
  notes: "",
};

describe("wholesaleRequestFormSchema", () => {
  it("accepts the minimum required fields (name + whatsapp)", () => {
    expect(wholesaleRequestFormSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects a missing name", () => {
    const result = wholesaleRequestFormSchema.safeParse({ ...validInput, first_name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing WhatsApp — it's the only way Pottery can follow up", () => {
    const result = wholesaleRequestFormSchema.safeParse({ ...validInput, whatsapp: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed email but allows an absent one", () => {
    expect(
      wholesaleRequestFormSchema.safeParse({ ...validInput, email: "not-an-email" }).success
    ).toBe(false);
    expect(wholesaleRequestFormSchema.safeParse({ ...validInput, email: "" }).success).toBe(true);
  });

  // Regression coverage for the 2026-09-09/10 P0 ("Invalid input: expected
  // string, received null"): `FormData.get()` returns a bare `null` for any
  // field the form doesn't render or the user leaves untouched — not `""`,
  // not `undefined`. The bug was a missing `website` input, but the fix
  // (lib/zod-helpers.ts) is general: every optional field must tolerate a
  // literal `null`, not just an empty string.
  it("accepts a full checkout with every optional field explicitly null", () => {
    const nullOptionals = {
      first_name: "Juli",
      last_name: null,
      company_name: null,
      cuit: null,
      instagram: null,
      website: null,
      city: null,
      province: null,
      whatsapp: "1123456789",
      email: null,
      notes: null,
    };
    const result = wholesaleRequestFormSchema.safeParse(nullOptionals);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.website).toBeNull();
      expect(result.data.last_name).toBeNull();
      expect(result.data.email).toBeNull();
    }
  });

  it("rejects a null name with a specific, non-generic message", () => {
    const result = wholesaleRequestFormSchema.safeParse({ ...validInput, first_name: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Falta el nombre.");
    }
  });

  it("rejects a null WhatsApp with a specific, non-generic message", () => {
    const result = wholesaleRequestFormSchema.safeParse({ ...validInput, whatsapp: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Falta un WhatsApp de contacto.");
    }
  });

  it("accepts an existing-customer-shaped payload where every optional column came back null from the DB", () => {
    // Mirrors what a Supabase row for an existing customer looks like: real
    // required fields, and `null` (never `undefined`) for every column the
    // customer never filled in.
    const existingCustomerRow = {
      first_name: "Marina",
      last_name: null,
      company_name: "Cerámica Marina",
      cuit: null,
      instagram: null,
      website: null,
      city: "CABA",
      province: null,
      whatsapp: "1145678901",
      email: null,
      notes: null,
    };
    expect(wholesaleRequestFormSchema.safeParse(existingCustomerRow).success).toBe(true);
  });
});
