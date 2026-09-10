import { describe, it, expect } from "vitest";
import { normalizePhoneForStorage } from "./phone";

describe("normalizePhoneForStorage", () => {
  it("adds the Argentine mobile '9' marker when it's missing (WhatsApp needs it, nobody says it)", () => {
    const result = normalizePhoneForStorage("11 2233-4455");
    expect(result.canonical).toBe("5491122334455");
    expect(result.isValid).toBe(true);
  });

  it("keeps an already-correct Argentine mobile number unchanged", () => {
    const result = normalizePhoneForStorage("91122334455");
    expect(result.canonical).toBe("5491122334455");
    expect(result.isValid).toBe(true);
  });

  it("handles a full E.164 Argentine mobile input the same way", () => {
    const result = normalizePhoneForStorage("+5491122334455");
    expect(result.canonical).toBe("5491122334455");
    expect(result.isValid).toBe(true);
  });

  it("applies the same mobile fix to a non-Buenos-Aires area code (Rosario, 341)", () => {
    const result = normalizePhoneForStorage("3415551234");
    expect(result.canonical).toBe("5493415551234");
    expect(result.isValid).toBe(true);
  });

  it("does not force the '9' marker on a non-Argentine number", () => {
    // Uruguay mobile, given in full international form — must not assume AR.
    const result = normalizePhoneForStorage("+59899123456");
    expect(result.canonical).toBe("59899123456");
    expect(result.isValid).toBe(true);
    expect(result.display).toContain("598");
  });

  it("produces a friendly international display format", () => {
    const result = normalizePhoneForStorage("11 2233-4455");
    expect(result.display).toBe("+54 9 11 2233 4455");
  });

  it("flags a too-short number as invalid without throwing", () => {
    const result = normalizePhoneForStorage("123");
    expect(result.isValid).toBe(false);
  });

  it("flags letters/garbage as invalid without throwing", () => {
    const result = normalizePhoneForStorage("no-soy-un-telefono");
    expect(result.isValid).toBe(false);
  });

  it("never throws on empty input", () => {
    expect(() => normalizePhoneForStorage("")).not.toThrow();
    expect(normalizePhoneForStorage("").isValid).toBe(false);
  });
});
