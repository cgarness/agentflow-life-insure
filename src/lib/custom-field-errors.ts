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
  // Marker set by translateCustomFieldError so callers need not re-parse translated text.
  if (e.orgWideNameConflict === true) return true;
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  // Matches the RAISE in the guard: '… already exists in this organization.'
  return code === "23505" && /already exists in this organization/i.test(message);
}

/** The three writes a custom-field error can come from. The wording depends on which one it was. */
export type CustomFieldOperation = "create" | "update" | "delete";

/**
 * Every user-facing custom-field failure message, in one place so tests pin them (approved wording,
 * D-5, 2026-09-22). A create never says "modify", and a platform privilege defect is never worded as
 * the user's own lack of permission.
 */
export const CUSTOM_FIELD_MESSAGES = {
  orgWideConflict: "A custom field with this name already exists in this agency.",
  ownerConflict: "A custom field with this name already exists.",
  denied: {
    create:
      "You don't have permission to create this custom field. If your role or organization changed recently, refresh the page and try again.",
    update: "You don't have permission to modify this custom field.",
    delete: "You don't have permission to delete this custom field.",
  },
  privilegeDefect: {
    create:
      "Custom fields can't be created right now because of a system configuration problem. This isn't caused by your account's permissions — please report it to AgentFlow support.",
    update:
      "Custom fields can't be changed right now because of a system configuration problem. This isn't caused by your account's permissions — please report it to AgentFlow support.",
    delete:
      "Custom fields can't be deleted right now because of a system configuration problem. This isn't caused by your account's permissions — please report it to AgentFlow support.",
  },
  orgMismatch:
    "Your session is signed in to a different organization than this page, so the field was not created. Refresh the page and try again — if it keeps happening, sign out and sign back in.",
  orgUnverified:
    "We couldn't confirm your organization, so the field was not created. Refresh the page and try again.",
  notCreated: "The custom field was not created. Try again.",
  viewAs:
    "Custom fields can't be created while you're viewing as another user. Exit View As to create fields under your own account.",
} as const;

function errorCode(err: unknown): string {
  const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : "";
}

function errorMessage(err: unknown): string {
  const message = err && typeof err === "object" ? (err as { message?: unknown }).message : undefined;
  return typeof message === "string" ? message : "";
}

/**
 * SQLSTATE 42501 raised by a row-level-security policy: an AUTHORIZATION decision about this user and
 * this row (`new row violates row-level security policy for table "custom_fields"`).
 */
export function isRowLevelSecurityRefusal(err: unknown): boolean {
  return errorCode(err) === "42501" && /row-level security/i.test(errorMessage(err));
}

/**
 * A missing GRANT — `permission denied for function|table|relation|schema|sequence|view|column …`.
 * That is a PLATFORM defect, never the user's lack of permission: the 2026-09-19 → 2026-09-22 outage
 * failed every custom-field create with `permission denied for function custom_field_norm` AFTER the
 * INSERT had already passed RLS. Shares SQLSTATE 42501 with an RLS refusal, so only the message tells
 * the two apart.
 */
export function isPrivilegeDefect(err: unknown): boolean {
  return /permission denied for (function|table|relation|schema|sequence|view|column)\b/i.test(errorMessage(err));
}

/**
 * Translate a PostgREST/PostgreSQL failure from a custom-field write into the message a user should see
 * for THAT operation. Order matters:
 *   1. the organization-wide name guard (23505) — unchanged text, marker preserved;
 *   2. a per-owner unique-index violation (23505) — unchanged text;
 *   3. a platform privilege defect — a system message, marked `privilegeDefect`;
 *   4. an RLS refusal, or any other 42501 / "permission" failure — the per-operation denial;
 *   5. anything else passes through unchanged.
 */
export function translateCustomFieldError(err: unknown, operation: CustomFieldOperation): Error {
  const message = errorMessage(err);
  const code = errorCode(err);
  if (isOrganizationWideCustomFieldConflict(err)) {
    // Deliberately does NOT claim the caller owns the existing field — under `custom_fields_select` it
    // may belong to another user's personal scope. The marker survives the translation so callers branch
    // on a flag rather than by re-parsing user-facing text.
    return Object.assign(new Error(CUSTOM_FIELD_MESSAGES.orgWideConflict), {
      orgWideNameConflict: true,
      code: "23505",
    });
  }
  if (code === "23505" || /already exists|unique_violation/i.test(message)) {
    return new Error(CUSTOM_FIELD_MESSAGES.ownerConflict);
  }
  if (isPrivilegeDefect(err)) {
    return Object.assign(new Error(CUSTOM_FIELD_MESSAGES.privilegeDefect[operation]), {
      code: "42501",
      privilegeDefect: true,
    });
  }
  if (code === "42501" || /row-level security|permission/i.test(message)) {
    return Object.assign(new Error(CUSTOM_FIELD_MESSAGES.denied[operation]), { code: "42501" });
  }
  return err instanceof Error ? err : new Error(message || "Unknown error");
}

export type CustomFieldContextReason = "org_mismatch" | "org_unverified";

/**
 * Thrown by `customFieldsSupabaseApi.create` BEFORE any INSERT is sent, when the page's organization
 * is not the one row-level security will compare against (`org_mismatch`) or cannot be confirmed
 * (`org_unverified`). Never a database error: no request reached `custom_fields`.
 */
export class CustomFieldContextError extends Error {
  readonly reason: CustomFieldContextReason;

  constructor(reason: CustomFieldContextReason) {
    super(reason === "org_mismatch" ? CUSTOM_FIELD_MESSAGES.orgMismatch : CUSTOM_FIELD_MESSAGES.orgUnverified);
    this.name = "CustomFieldContextError";
    this.reason = reason;
  }
}

export function isCustomFieldContextError(err: unknown): err is CustomFieldContextError {
  return err instanceof CustomFieldContextError;
}
