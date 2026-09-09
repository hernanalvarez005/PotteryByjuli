import { describe, it, expect } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Workshop Niños")).toBe("workshop-ninos");
  });

  it("strips accents", () => {
    expect(slugify("Cerámica para Niños")).toBe("ceramica-para-ninos");
  });

  it("collapses punctuation and repeated separators into single hyphens", () => {
    expect(slugify("Cerámica — La Plata, Septiembre 2026")).toBe(
      "ceramica-la-plata-septiembre-2026"
    );
  });

  it("has no leading or trailing hyphen", () => {
    expect(slugify("  Workshop  ")).toBe("workshop");
  });
});
