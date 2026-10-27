// Typed custom-field values for mapping v2, and the stored form of standard values for previews. Pure (no Deno or
// Supabase APIs) so the app test suite can import it.
//
// LOSSLESS ONLY (approved 2026-10-27): a value is rewritten only when the rewrite keeps every digit, the sign and every
// decimal place, and the meaning is certain. Everything else is stored EXACTLY as the sheet shows it and flagged
// `kept_as_text`, so a preview never promises a conversion the import does not make. Text, Phone, Email and Dropdown
// values (ZIP codes, identifiers) are never transformed.

export type CustomFieldType = "Text" | "Number" | "Date" | "Dropdown" | "Email" | "Phone";

/** The value that is stored, and why it was not converted when its field type expected a conversion. */
export interface TypedValue { value: string; kept_as_text?: true; not_an_option?: true }

/** Sheets locales whose short date is month first. Any other locale (or none) never converts M/D/Y dates. */
export const MONTH_FIRST_LOCALES: ReadonlySet<string> = new Set(["en_US", "es_US"]);

/** Same shape the contact view treats as a number (contact-detail-fields.ts), without exponents. */
const PLAIN_NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/;
/** Optional sign, then an optional "$", then digits with valid thousands groups, then an optional fraction. */
const FORMATTED_NUMBER = /^(-?)(\$?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/;

/**
 * Number: removes only a leading "$" (also after "-") and valid thousands commas. A leading zero on the integer part
 * ("007", "02134") means the value may be an identifier, so it is never rewritten.
 */
export function normalizeNumber(raw: string): TypedValue {
  if (PLAIN_NUMBER.test(raw)) return { value: raw };
  const m = raw.match(FORMATTED_NUMBER);
  if (m) {
    const int = m[3].replace(/,/g, "");
    if (!(int.length > 1 && int.startsWith("0"))) return { value: `${m[1]}${int}${m[4] ?? ""}` };
  }
  return { value: raw, kept_as_text: true };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Date: YYYY-M-D / YYYY/M/D always; M/D/YYYY (same separator: / - .) only in a month-first sheet locale. A real
 * calendar date with a four-digit year and no time part, or the value is kept exactly.
 */
export function normalizeDate(raw: string, locale: string | null): TypedValue {
  const ymd = raw.match(/^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/);
  if (ymd) {
    const iso = isoDate(Number(ymd[1]), Number(ymd[3]), Number(ymd[4]));
    if (iso) return { value: iso };
  }
  const mdy = raw.match(/^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/);
  if (mdy && locale !== null && MONTH_FIRST_LOCALES.has(locale)) {
    const iso = isoDate(Number(mdy[4]), Number(mdy[1]), Number(mdy[3]));
    if (iso) return { value: iso };
  }
  return { value: raw, kept_as_text: true };
}

export interface TypedFieldInfo { type: CustomFieldType | string | null; options?: string[] | null }

/** The stored form of one non-empty custom value. Unknown or missing types behave as Text. */
export function typedValue(raw: string, field: TypedFieldInfo | undefined, locale: string | null): TypedValue {
  switch (field?.type) {
    case "Number": return normalizeNumber(raw);
    case "Date": return normalizeDate(raw, locale);
    case "Dropdown": return Array.isArray(field.options) && !field.options.includes(raw) ? { value: raw, not_an_option: true } : { value: raw };
    default: return { value: raw };
  }
}

// ---- public.normalize_us_state port (baseline schema): previews show the state exactly as ingest stores it. ----
// Parity with the SQL function is asserted in supabase/tests/google_sheets_mapping_v2.sql.
const USPS = new Set(["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
  "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"]);
const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
/** SQL btrim trims spaces only; JS trim() would also strip tabs and newlines. */
const btrim = (s: string) => s.replace(/^ +| +$/g, "");

export function normalizeUsState(raw: string): string {
  const t = btrim(raw);
  if (t === "") return raw;
  const upper = t.toUpperCase();
  if (USPS.has(upper)) return upper;
  return STATE_NAMES[t.toLowerCase()] ?? raw;
}
