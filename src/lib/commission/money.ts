/**
 * Exact, non-negative rational arithmetic on BigInt (no binary floating point anywhere), plus
 * display-only rounding to cents (half-up). Intermediate values are never rounded.
 */
export interface Rational {
  num: bigint;
  /** Always > 0; the fraction is kept reduced. */
  den: bigint;
}

const DECIMAL_TEXT = /^(\d+)(?:\.(\d+))?$/;

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function reduce(num: bigint, den: bigint): Rational {
  if (den <= 0n) throw new RangeError("denominator must be positive");
  const divisor = gcd(num, den) || 1n;
  return { num: num / divisor, den: den / divisor };
}

/** Plain decimal text ("100", "87.5", "0.30000000000000004") to an exact rational; anything else -> null. */
export function parseDecimal(text: string): Rational | null {
  const match = DECIMAL_TEXT.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? "";
  return reduce(BigInt(match[1] + fraction), 10n ** BigInt(fraction.length));
}

export const integer = (value: number | bigint): Rational => ({ num: BigInt(value), den: 1n });
export const multiply = (a: Rational, b: Rational): Rational => reduce(a.num * b.num, a.den * b.den);
export const divideBy = (a: Rational, divisor: bigint): Rational => reduce(a.num, a.den * divisor);
export const subtract = (a: Rational, b: Rational): Rational => reduce(a.num * b.den - b.num * a.den, a.den * b.den);
export const add = (a: Rational, b: Rational): Rational => reduce(a.num * b.den + b.num * a.den, a.den * b.den);
export const equals = (a: Rational, b: Rational): boolean => a.num === b.num && a.den === b.den;

/** Round a NON-NEGATIVE value to whole cents, half-up — for display only. */
export function toCents(value: Rational): bigint {
  if (value.num < 0n) throw new RangeError("toCents expects a non-negative value");
  return (value.num * 200n + value.den) / (2n * value.den);
}

/** "$1,234.56" from an exact non-negative value (display-only rounding). */
export function formatUsd(value: Rational): string {
  const cents = toCents(value);
  const dollars = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${dollars}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** "83.4%" from exact rate text ("83.40" -> "83.4%", "105" -> "105%", "0" -> "0%"); the value is unchanged. */
export function formatRatePercent(text: string): string {
  const [whole, fraction = ""] = text.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `${whole}${trimmed ? `.${trimmed}` : ""}%`;
}
