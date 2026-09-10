import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Regression guard for the carousel↔variante sync in
// app/mayorista/product-card.tsx (precisión de la usuaria en la tanda de
// mejoras operativas — sección 5): el ciclo
// IntersectionObserver → setVariant → scrollIntoView → IntersectionObserver
// → ... se corta con un ref booleano (isProgrammaticScrollRef) que se
// pone en true antes de un scroll disparado por el <Select> de variante,
// y que el observer respeta para ignorar esa intersección. No es
// reproducible de forma confiable en un E2E real (el scroll "smooth" no
// termina de animar en el navegador automatizado de este entorno — se
// confirmó en vivo que el mismo scrollIntoView con behavior "instant" sí
// completa y con "smooth" nunca lo hace, incluso esperando más de un
// segundo), así que, siguiendo la misma convención ya establecida en este
// proyecto para este tipo de caso
// (tests/product-bulk-delete-transactional.test.ts), esto confirma
// estáticamente que el guard sigue en su lugar en el código fuente.
const PRODUCT_CARD_PATH = path.resolve(__dirname, "..", "app/mayorista/product-card.tsx");

describe("wholesale carousel ↔ variant sync never loops", () => {
  const source = readFileSync(PRODUCT_CARD_PATH, "utf-8");

  it("the IntersectionObserver callback bails out while a programmatic scroll is in flight", () => {
    const observerMatch = source.match(
      /const observer = new IntersectionObserver\(\s*\(entries\) => \{([\s\S]*?)\},\s*\{ root: container/
    );
    expect(observerMatch).not.toBeNull();
    const callbackBody = observerMatch![1];
    expect(callbackBody).toMatch(/if \(isProgrammaticScrollRef\.current\) return;/);
  });

  it("selecting a variant sets the guard before scrolling, and always resets it afterward", () => {
    expect(source).toMatch(/isProgrammaticScrollRef\.current = true;\s*\n\s*target\.scrollIntoView/);
    // Reset via scrollend when supported, a timeout fallback otherwise —
    // never left permanently true (which would silently freeze the
    // swipe→variant direction forever).
    expect(source).toMatch(/isProgrammaticScrollRef\.current = false;/g);
    const resetCount = (source.match(/isProgrammaticScrollRef\.current = false;/g) ?? []).length;
    expect(resetCount).toBeGreaterThanOrEqual(2); // scrollend handler + timeout fallback
  });

  it("a general image (variantId null) never drives a variant change from the observer", () => {
    expect(source).toMatch(/if \(img\.variantId && img\.variantId !== prevSelectedVariantId\.current\)/);
  });
});
