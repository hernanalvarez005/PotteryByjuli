import { describe, it, expect } from "vitest";
import { groupSchema, dueSchema, duePaymentSchema } from "./workshops";

const baseGroup = {
  program_id: "11111111-1111-4111-8111-111111111111",
  name: "Martes 18hs",
  schedule: "",
  weekday: "",
  start_time: "",
  end_time: "",
  location_id: "",
  capacity: "8",
};

describe("groupSchema.monthly_fee", () => {
  it("is optional — a group with no fee configured yet is valid", () => {
    const result = groupSchema.safeParse({ ...baseGroup, monthly_fee: "" });
    if (!result.success) throw new Error("expected success");
    expect(result.data.monthly_fee).toBeNull();
  });

  it("parses a real fee", () => {
    const result = groupSchema.safeParse({ ...baseGroup, monthly_fee: "45000" });
    if (!result.success) throw new Error("expected success");
    expect(result.data.monthly_fee).toBe(45000);
  });

  it("rejects a negative fee", () => {
    expect(groupSchema.safeParse({ ...baseGroup, monthly_fee: "-100" }).success).toBe(false);
  });
});

describe("dueSchema.period", () => {
  it("accepts AAAA-MM", () => {
    expect(dueSchema.safeParse({ period: "2026-09", amount: "45000" }).success).toBe(true);
  });

  it("rejects anything else, so a generated due can't drift from the AAAA-MM convention", () => {
    expect(dueSchema.safeParse({ period: "septiembre 2026", amount: "45000" }).success).toBe(false);
    expect(dueSchema.safeParse({ period: "2026-9", amount: "45000" }).success).toBe(false);
  });
});

describe("duePaymentSchema", () => {
  it("requires a positive amount — a 0 payment isn't a real payment", () => {
    expect(duePaymentSchema.safeParse({ amount: "0" }).success).toBe(false);
    expect(duePaymentSchema.safeParse({ amount: "1000" }).success).toBe(true);
  });

  it("method and account are optional", () => {
    const result = duePaymentSchema.safeParse({ amount: "1000", method_id: "", account_id: "" });
    if (!result.success) throw new Error("expected success");
    expect(result.data.method_id).toBeNull();
    expect(result.data.account_id).toBeNull();
  });
});
