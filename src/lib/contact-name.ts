/**
 * contact-name — the ONE place that turns a contact record into a display name,
 * and the ONE guard that keeps placeholder debris out of a persisted name snapshot.
 *
 * Why this module exists (production defect, 2026-08-11):
 * `ContactDeepLinkPage` and `CalendarPage` fetch contacts with `select("*")`, so they
 * hold RAW database rows (`first_name` / `last_name`). `FullScreenContactView` reads the
 * canonical camelCase shape (`firstName` / `lastName`), so its Call button built the
 * template literal `` `${contact.firstName} ${contact.lastName}` `` and produced the
 * literal string **"undefined undefined"** — which `FloatingDialer` forwarded to
 * `TwilioContext.makeCall()` and which was then snapshotted into `calls.contact_name`.
 *
 * The real fix is the row mapping at those two page boundaries (canonical `rowToLead` /
 * `rowToClient` / `rowToRecruit`). These helpers are the belt-and-braces layer:
 *
 *  - `contactDisplayName` reads canonical camelCase FIRST and falls back to snake_case,
 *    so a partially-mapped or future un-mapped caller still yields a real name.
 *  - `sanitizeContactName` is the last guard before a name is persisted.
 *
 * Both are pure, synchronous and dependency-free — no Supabase, no React, no DB lookup.
 * `sanitizeContactName` sits on the 300+ dials/day path (VISION §2) and must stay O(n)
 * over a short string with no allocation surprises.
 */

/**
 * Tokens a JavaScript template literal emits for a missing value.
 *
 * Matching is deliberately CASE-SENSITIVE and exact-token: `undefined` / `null` are what
 * the interpolation of `undefined` / `null` produces, always lowercase. "Null" is a real
 * surname and "Undefined" could legitimately begin a nickname — capitalised forms are
 * preserved untouched.
 */
const PLACEHOLDER_NAME_TOKENS: ReadonlySet<string> = new Set(["undefined", "null"]);

/**
 * Strip placeholder debris and collapse whitespace in a display name.
 *
 * Filtering is per-token, not whole-string, so a half-resolved name keeps its real half:
 *   "undefined undefined" -> ""   (caller writes NULL, never the literal)
 *   "null null"           -> ""
 *   "   " / "" / non-string -> ""
 *   "Charlotte undefined" -> "Charlotte"
 *   "Charlotte Kearney"   -> "Charlotte Kearney"  (unchanged)
 *   "Null"                -> "Null"               (real surname, unchanged)
 *
 * Returns "" when nothing survives. Callers persisting the value should write
 * `sanitizeContactName(x) || null` so the column holds NULL rather than an empty string.
 */
export function sanitizeContactName(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") return "";
  const kept: string[] = [];
  for (const token of raw.split(/\s+/)) {
    if (token === "" || PLACEHOLDER_NAME_TOKENS.has(token)) continue;
    kept.push(token);
  }
  return kept.join(" ");
}

/** Read one name part: canonical camelCase first, raw-row snake_case as the fallback. */
function readNamePart(source: Record<string, unknown>, camelKey: string, snakeKey: string): string {
  const value = source[camelKey] ?? source[snakeKey];
  return typeof value === "string" ? value : "";
}

/**
 * Resolve a contact's display name from either shape — canonical (`firstName`/`lastName`,
 * what `rowToLead` / `rowToClient` / `rowToRecruit` produce) or a raw Supabase row
 * (`first_name`/`last_name`).
 *
 * Always sanitized, so this can never return "undefined undefined". Returns "" when no
 * name can be resolved: a nameless contact must still be dialable (the dialer falls back
 * to the phone number for display), so callers must NOT treat "" as a reason to block a
 * call — only as a reason to persist NULL.
 */
export function contactDisplayName(contact: unknown): string {
  if (!contact || typeof contact !== "object") return "";
  const source = contact as Record<string, unknown>;
  const first = readNamePart(source, "firstName", "first_name");
  const last = readNamePart(source, "lastName", "last_name");
  return sanitizeContactName(`${first} ${last}`);
}
