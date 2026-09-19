/**
 * profile-format — the display formatters shared by every Agent/Team Profile surface.
 *
 * Pure functions, kept out of the component file so they can be unit-tested directly and so the
 * presentational primitives stay under the component size rule.
 *
 * The currency rules mirror `formatCurrencyValue` (src/lib/supabase-clients.ts:181-188): a missing
 * OR zero value renders as a dash, never as a fabricated "$0". `clients.premium` and
 * `clients.face_amount` both DEFAULT 0, so `0` genuinely means "not recorded" — and the aggregate
 * and the display have to agree on that or a book of blanks would report a total.
 */

/** A MONTHLY premium figure. Never annualized anywhere in this feature. */
export function formatMonthlyCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "—";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A face amount. Whole dollars — face amounts are never expressed in cents. */
export function formatWholeCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "—";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** A count. Unlike currency, `0` is a real answer here and is shown as `0`, not a dash. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US");
}

/**
 * `2026-01` -> `January 2026`.
 *
 * Constructed and read in UTC on purpose: the bucket comes from `clients.sold_date`, a true `date`
 * with no time and no timezone, so introducing a local-time interpretation here could shift a
 * January bucket into December for anyone west of UTC.
 */
export function formatMonthBucket(bucket: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(bucket);
  if (!match) return bucket;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
