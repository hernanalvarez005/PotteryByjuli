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
});
