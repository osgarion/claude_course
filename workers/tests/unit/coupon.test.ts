import { describe, expect, it } from "vitest";

import { discountFor, isValidNow, type Coupon } from "../../src/domain/coupon.js";

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 1,
    code: "TEST",
    discount_type: "percent",
    value_cents: 1000, // 10,00 %
    is_active: 1,
    valid_from: null,
    valid_to: null,
    ...overrides,
  };
}

describe("discountFor", () => {
  it("procentní sleva", () => {
    // 10 % z 200,00 = 20,00
    expect(discountFor(coupon(), 20000)).toBe(2000);
  });

  it("pevná sleva", () => {
    expect(discountFor(coupon({ discount_type: "fixed", value_cents: 5000 }), 20000)).toBe(5000);
  });

  it("pevná sleva nikdy nepřekročí mezisoučet", () => {
    expect(discountFor(coupon({ discount_type: "fixed", value_cents: 50000 }), 20000)).toBe(20000);
  });

  it("procenta se zaokrouhlí na halíře", () => {
    // 33,333 % z 10,00 = 3,3333 -> 3,33
    expect(discountFor(coupon({ value_cents: 3333 }), 1000)).toBe(333);
  });
});

describe("isValidNow", () => {
  const now = new Date("2026-07-12T12:00:00Z");

  it("neaktivní kupón neplatí", () => {
    expect(isValidNow(coupon({ is_active: 0 }), now)).toBe(false);
  });

  it("respektuje okno platnosti", () => {
    expect(isValidNow(coupon({ valid_to: "2026-07-01T00:00:00Z" }), now)).toBe(false);
    expect(isValidNow(coupon({ valid_from: "2026-08-01T00:00:00Z" }), now)).toBe(false);
    expect(
      isValidNow(coupon({ valid_from: "2026-07-01T00:00:00Z", valid_to: "2026-08-01T00:00:00Z" }), now),
    ).toBe(true);
  });

  it("bez omezení platí", () => {
    expect(isValidNow(coupon(), now)).toBe(true);
  });
});
