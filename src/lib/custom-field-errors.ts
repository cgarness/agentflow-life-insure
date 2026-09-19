/**
 * Custom-field error classification.
 *
 * Deliberately a standalone module rather than part of `supabase-settings`: eight test
 * files `vi.mock("@/lib/supabase-settings")` with narrow stubs, and a consumer importing
 * this predicate from there would get `undefined` in every one of them. Keeping it here
 * means the mocks stay valid and the behaviour is unit-testable without a Supabase double.
 */

/**
 * True when a failure came from the ORGANIZATION-WIDE logical-name guard
 * (`private.custom_fields_logical_name_guard`) rather than from one of the two
 * pre-existing per-owner unique indexes.
 *
 * All three raise SQLSTATE 23505, but they mean different things. The per-owner indexes
 * only ever fire on a row the caller already owns. The organization-wide guard can fire on
 * a definition the caller cannot even SELECT, because `custom_fields_select` hides another
 * user's personal rows — so the UI must never respond to it with "you already have this".
 */
export function isOrganizationWideCustomFieldConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { orgWideNameConflict?: unknown; code?: unknown; message?: unknown };
  // Marker set by friendlyCustomFieldError so callers need not re-parse translated text.
  if (e.orgWideNameConflict === true) return true;
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  // Matches the RAISE in the guard: '… already exists in this organization.'
  return code === "23505" && /already exists in this organization/i.test(message);
}
