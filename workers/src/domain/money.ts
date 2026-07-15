/**
 * Peníze. V databázi celá čísla v halířích, na drátě řetězce ("49.90").
 *
 * Nikde ve výpočtech nesmí figurovat float - 0.1 + 0.2 !== 0.3 a u peněz
 * je taková chyba nepřijatelná. Proto je všechno integer aritmetika.
 */

/** Dělení se zaokrouhlením "na sudou" (banker's rounding). */
export function divRoundHalfEven(numerator: number, denominator: number): number {
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  const twice = remainder * 2;

  if (twice > denominator) return quotient + 1;
  if (twice < denominator) return quotient;
  // přesně půl -> zaokrouhli k sudému (shoda s Python Decimal.quantize,
  // který používá ROUND_HALF_EVEN; jinak by se totály lišily od Djanga)
  return quotient % 2 === 0 ? quotient : quotient + 1;
}

/** 4990 -> "49.90" */
export function centsToString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}

/**
 * "49.90" -> 4990. Přísně přes regex, nikdy parseFloat (ten by tiše
 * spolknul "49.9abc" i vědecký zápis).
 */
export function parseCents(value: string | number): number {
  const text = typeof value === "number" ? String(value) : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    throw new Error(`Neplatná peněžní hodnota: ${JSON.stringify(value)}`);
  }
  const [, sign, whole, frac = ""] = match;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return sign === "-" ? -cents : cents;
}
