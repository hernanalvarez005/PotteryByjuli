import { describe, it, expect } from "vitest";
import { slugSchema, eventSchema, publicRegistrationSchema } from "./events";

describe("slugSchema", () => {
  it("accepts a lowercase-hyphenated slug", () => {
    expect(slugSchema.safeParse("ceramica-ninos-la-plata").success).toBe(true);
  });

  it("rejects spaces and uppercase mixed in", () => {
    expect(slugSchema.safeParse("Cerámica Niños").success).toBe(false);
  });

  it("rejects a leading or trailing hyphen", () => {
    expect(slugSchema.safeParse("-workshop").success).toBe(false);
    expect(slugSchema.safeParse("workshop-").success).toBe(false);
  });
});

describe("eventSchema", () => {
  const base = {
    event_type: "workshop" as const,
    name: "Workshop Niños",
    slug: "workshop-ninos",
    description: "",
    location_id: "",
    address: "",
    event_date: "2026-09-12",
    start_time: "15:00",
    end_time: "17:00",
    schedule: "",
    capacity: "12",
    price: "15000",
    cost_estimate: "",
    payment_account_id: "",
    additional_info: "",
    is_registration_open: "on",
    notes: "",
  };

  it("accepts a well-formed workshop", () => {
    const result = eventSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("rejects a zero or negative capacity", () => {
    expect(eventSchema.safeParse({ ...base, capacity: "0" }).success).toBe(false);
  });

  it("un-checking the box means registrations are NOT open", () => {
    const result = eventSchema.safeParse({ ...base, is_registration_open: "" });
    if (!result.success) throw new Error("expected success");
    expect(result.data.is_registration_open).toBe(false);
  });
});

describe("publicRegistrationSchema", () => {
  it("requires whatsapp — it's the only way Pottery follows up", () => {
    const result = publicRegistrationSchema.safeParse({
      first_name: "Juli",
      last_name: "",
      whatsapp: "",
      email: "",
      participant_name: "",
      notes: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts the minimum required fields", () => {
    const result = publicRegistrationSchema.safeParse({
      first_name: "Juli",
      last_name: "",
      whatsapp: "1123456789",
      email: "",
      participant_name: "",
      notes: "",
    });
    expect(result.success).toBe(true);
  });
});
