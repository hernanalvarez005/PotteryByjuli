import { describe, it, expect } from "vitest";
import { buildWholesaleShareMessage, canShareFile, wholesalePdfFileName, SHARE_LINK_TTL_HOURS } from "./wholesale-share";

const base = { customerFirstName: "Ana", humanCode: "MAY-000031", totalLabel: "$ 160.000" };
const file = new File(["%PDF"], "MAY-000031.pdf", { type: "application/pdf" });

describe("buildWholesaleShareMessage", () => {
  it("con link: saludo, código, total, link y vigencia", () => {
    const msg = buildWholesaleShareMessage({ ...base, documentUrl: "https://x.test/pdf?token=abc" });
    expect(msg).toContain("Hola Ana!");
    expect(msg).toContain("MAY-000031");
    expect(msg).toContain("$ 160.000");
    expect(msg).toContain("https://x.test/pdf?token=abc");
    expect(msg).toContain(`${SHARE_LINK_TTL_HOURS} horas`);
  });

  it("sin link (PDF adjunto): no menciona ningún link ni vencimiento", () => {
    const msg = buildWholesaleShareMessage({ ...base, documentUrl: null });
    expect(msg).toContain("Te adjunto el PDF");
    expect(msg).not.toContain("http");
    expect(msg).not.toContain("vence");
  });

  it("sin nombre: saludo genérico, sin 'undefined' ni 'null'", () => {
    for (const name of [null, undefined, "  "]) {
      const msg = buildWholesaleShareMessage({ ...base, customerFirstName: name, documentUrl: null });
      expect(msg.startsWith("Hola!")).toBe(true);
      expect(msg).not.toMatch(/undefined|null/);
    }
  });
});

describe("canShareFile (Web Share sólo cuando de verdad está disponible)", () => {
  it("sin navigator, sin share o sin canShare → false", () => {
    expect(canShareFile(undefined, file)).toBe(false);
    expect(canShareFile({ share: () => Promise.resolve() }, file)).toBe(false);
    expect(canShareFile({ canShare: () => true }, file)).toBe(false);
  });

  it("canShare responde false (típico en escritorio) → false", () => {
    expect(canShareFile({ share: () => Promise.resolve(), canShare: () => false }, file)).toBe(false);
  });

  it("canShare responde true → true, y se le pasa el archivo", () => {
    let received: File[] | undefined;
    const nav = { share: () => Promise.resolve(), canShare: (d: { files?: File[] }) => ((received = d.files), true) };
    expect(canShareFile(nav, file)).toBe(true);
    expect(received).toEqual([file]);
  });

  it("canShare que lanza → false (nunca propaga)", () => {
    expect(canShareFile({ share: () => Promise.resolve(), canShare: () => { throw new Error("x"); } }, file)).toBe(false);
  });
});

describe("wholesalePdfFileName", () => {
  it("es el código del pedido", () => expect(wholesalePdfFileName("MAY-000031")).toBe("MAY-000031.pdf"));
});
