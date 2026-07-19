/** Slevové kupóny - čistá logika, port z Coupon.is_valid_now/discount_for. */
import { divRoundHalfEven } from "./money.js";

export type DiscountType = "percent" | "fixed";

export interface Coupon {
  id: number;
  code: string;
  discount_type: DiscountType;
  /** 'fixed' -> halíře; 'percent' -> setiny procenta (1000 = 10,00 %) */
  value_cents: number;
  is_active: number;
  valid_from: string | null;
  valid_to: string | null;
}

export function isValidNow(coupon: Coupon, now: Date = new Date()): boolean {
  if (!coupon.is_active) return false;
  const nowIso = now.toISOString();
  if (coupon.valid_from && nowIso < coupon.valid_from) return false;
  if (coupon.valid_to && nowIso > coupon.valid_to) return false;
  return true;
}

/** Sleva v halířích, nikdy víc než mezisoučet. */
export function discountFor(coupon: Coupon, subtotalCents: number): number {
  const discount =
    coupon.discount_type === "percent"
      ? // value_cents jsou setiny procenta, takže dělíme 100 (procenta) * 100 (setiny)
        divRoundHalfEven(subtotalCents * coupon.value_cents, 10_000)
      : coupon.value_cents;

  return Math.min(discount, subtotalCents);
}
