import { describe, it, expect } from "vitest";
import { customerDisplayName, whatsappLink } from "./customers";

describe("customerDisplayName", () => {
  it("joins first and last name", () => {
    expect(customerDisplayName({ first_name: "María", last_name: "Gómez" })).toBe(
      "María Gómez"
    );
  });

  it("drops a missing last name instead of leaving a trailing space", () => {
    expect(customerDisplayName({ first_name: "María", last_name: null })).toBe("María");
  });
});

describe("whatsappLink", () => {
  it("strips spaces and dashes before building the link", () => {
    expect(whatsappLink("11 2345-6789")).toBe("https://wa.me/541123456789");
  });

  it("assumes the Argentina country code when the number doesn't already have it", () => {
    const link = whatsappLink("11 2345 6789");
    expect(link).toBe("https://wa.me/541123456789");
  });

  it("doesn't double the country code when it's already present", () => {
    const link = whatsappLink("5491123456789");
    expect(link).toBe("https://wa.me/5491123456789");
  });
});
