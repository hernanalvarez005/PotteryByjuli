import { describe, it, expect } from "vitest";
import { wholesaleRequestFormSchema } from "./wholesale";

// Campos obligatorios del checkout mayorista (sección 2 del brief de
// extensión): Nombre, Apellido, WhatsApp, Email, Razón social/Comercio,
// Ciudad, Provincia. Opcionales: CUIT, Instagram, Web, Dirección, Código
// postal, Observaciones. Este contrato reemplaza al del P0 anterior (donde
// sólo Nombre+WhatsApp eran obligatorios) — ver docs/business-rules.md.
const validInput = {
  first_name: "Juli",
  last_name: "Fernández",
  company_name: "Casa Magnolia",
  cuit: "",
  instagram: "",
  website: "",
  city: "Rosario",
  province: "Santa Fe",
  address: "",
  postal_code: "",
  whatsapp: "1123456789",
  email: "juli@example.com",
  notes: "",
};

const REQUIRED_FIELDS_AND_MESSAGES: Record<string, string> = {
  first_name: "Falta el nombre.",
  last_name: "Falta el apellido.",
  company_name: "Falta la razón social o el nombre del comercio.",
  city: "Falta la ciudad.",
  province: "Falta la provincia.",
  whatsapp: "Falta un WhatsApp de contacto.",
  email: "Falta el email.",
};

describe("wholesaleRequestFormSchema", () => {
  it("accepts a full submission with every required field present", () => {
    expect(wholesaleRequestFormSchema.safeParse(validInput).success).toBe(true);
  });

  for (const [field, message] of Object.entries(REQUIRED_FIELDS_AND_MESSAGES)) {
    it(`rejects a missing ${field} with its own message, not a generic error`, () => {
      const result = wholesaleRequestFormSchema.safeParse({ ...validInput, [field]: "" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(message);
      }
    });

    it(`rejects a null ${field} with the same specific message (not Zod's generic type error)`, () => {
      const result = wholesaleRequestFormSchema.safeParse({ ...validInput, [field]: null });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(message);
      }
    });
  }

  it("rejects a malformed email", () => {
    const result = wholesaleRequestFormSchema.safeParse({ ...validInput, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("accepts every optional field (cuit/instagram/website/address/postal_code/notes) explicitly null", () => {
    const result = wholesaleRequestFormSchema.safeParse({
      ...validInput,
      cuit: null,
      instagram: null,
      website: null,
      address: null,
      postal_code: null,
      notes: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cuit).toBeNull();
      expect(result.data.address).toBeNull();
      expect(result.data.postal_code).toBeNull();
    }
  });

  it("accepts every optional field as undefined (field absent from the payload)", () => {
    const requiredOnly = {
      first_name: validInput.first_name,
      last_name: validInput.last_name,
      company_name: validInput.company_name,
      city: validInput.city,
      province: validInput.province,
      whatsapp: validInput.whatsapp,
      email: validInput.email,
    };
    expect(wholesaleRequestFormSchema.safeParse(requiredOnly).success).toBe(true);
  });

  it("accepts an existing-customer-shaped payload: required fields present, optionals null from the DB", () => {
    // Mirrors a Supabase row for an existing customer being reused by the
    // dedup logic — required columns always have a value, optional
    // columns come back null (never undefined).
    const existingCustomerShaped = {
      first_name: "Marina",
      last_name: "Gómez",
      company_name: "Cerámica Marina",
      cuit: null,
      instagram: null,
      website: null,
      city: "CABA",
      province: "Buenos Aires",
      address: null,
      postal_code: null,
      whatsapp: "1145678901",
      email: "marina@example.com",
      notes: null,
    };
    expect(wholesaleRequestFormSchema.safeParse(existingCustomerShaped).success).toBe(true);
  });
});
