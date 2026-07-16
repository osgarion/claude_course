import { describe, expect, it } from "vitest";

import { effectivePriceCents } from "../../src/domain/variant.js";
import { slugify } from "../../src/domain/slug.js";

describe("effectivePriceCents", () => {
  const product = { price_cents: 50000 };

  it("varianta bez override padá zpět na cenu produktu", () => {
    expect(effectivePriceCents(product, { price_override_cents: null })).toBe(50000);
    expect(effectivePriceCents(product, null)).toBe(50000);
  });

  it("varianta s override používá vlastní cenu", () => {
    expect(effectivePriceCents(product, { price_override_cents: 45000 })).toBe(45000);
  });

  it("override 0 musí přebít cenu produktu, ne být brán jako 'žádný override'", () => {
    // klasická past: `override || product.price` by tady vrátilo 50000
    expect(effectivePriceCents(product, { price_override_cents: 0 })).toBe(0);
  });
});

describe("slugify", () => {
  it("odstraní diakritiku a mezery", () => {
    expect(slugify("Mechanická klávesnice Mini")).toBe("mechanicka-klavesnice-mini");
    expect(slugify("Hrnky a šálky")).toBe("hrnky-a-salky");
    expect(slugify("8-Bit Energy Drink")).toBe("8-bit-energy-drink");
  });
});
