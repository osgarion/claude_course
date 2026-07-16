import { describe, expect, it } from "vitest";

import { centsToString, divRoundHalfEven, parseCents } from "../../src/domain/money.js";

describe("centsToString", () => {
  it("formátuje halíře na dvě desetinná místa", () => {
    expect(centsToString(4990)).toBe("49.90");
    expect(centsToString(129900)).toBe("1299.00");
    expect(centsToString(5)).toBe("0.05");
    expect(centsToString(0)).toBe("0.00");
  });
});

describe("parseCents", () => {
  it("čte řetězce i celá čísla", () => {
    expect(parseCents("49.90")).toBe(4990);
    expect(parseCents("1299")).toBe(129900);
    expect(parseCents("0.5")).toBe(50);
  });

  it("odmítne nesmysly místo aby je tiše spolknul jako parseFloat", () => {
    expect(() => parseCents("49.9abc")).toThrow();
    expect(() => parseCents("1e3")).toThrow();
    expect(() => parseCents("")).toThrow();
  });
});

describe("divRoundHalfEven", () => {
  it("zaokrouhluje k sudému při přesné půlce (shoda s Python Decimal)", () => {
    // 2.5 -> 2 (sudé), 3.5 -> 4 (sudé)
    expect(divRoundHalfEven(5, 2)).toBe(2);
    expect(divRoundHalfEven(7, 2)).toBe(4);
  });

  it("běžné zaokrouhlení nahoru/dolů", () => {
    expect(divRoundHalfEven(6, 4)).toBe(2); // 1.5 -> 2 (sudé)
    expect(divRoundHalfEven(10, 4)).toBe(2); // 2.5 -> 2 (sudé)
    expect(divRoundHalfEven(11, 4)).toBe(3); // 2.75 -> 3
    expect(divRoundHalfEven(9, 4)).toBe(2); // 2.25 -> 2
  });
});
