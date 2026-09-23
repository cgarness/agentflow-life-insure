/**
 * The organization-wide logical-name guard and the two pre-existing per-owner unique
 * indexes all raise SQLSTATE 23505, but they mean different things. Misclassifying them
 * makes the UI tell a user "you already have this" about a field that belongs to someone
 * else and that RLS hides from them — and, worse, would let the import map into a
 * definition the importer cannot resolve. These cases pin the discrimination.
 */
import { describe, it, expect } from "vitest";

import {
  CUSTOM_FIELD_MESSAGES,
  CustomFieldContextError,
  isCustomFieldContextError,
  isOrganizationWideCustomFieldConflict,
  isPrivilegeDefect,
  isRowLevelSecurityRefusal,
  translateCustomFieldError,
  type CustomFieldOperation,
} from "@/lib/custom-field-errors";

const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });

describe("isOrganizationWideCustomFieldConflict", () => {
  it("recognises the guard's own exception (matches the SQL RAISE verbatim)", () => {
    expect(
      isOrganizationWideCustomFieldConflict(
        pgError("23505", 'A custom field named "Gender" already exists in this organization.'),
      ),
    ).toBe(true);
  });

  it("recognises the marker friendlyCustomFieldError attaches after translation", () => {
    const translated = Object.assign(new Error("A custom field with this name already exists in this agency."), {
      orgWideNameConflict: true,
      code: "23505",
    });
    expect(isOrganizationWideCustomFieldConflict(translated)).toBe(true);
  });

  it("does NOT claim a per-owner unique-index violation", () => {
    expect(
      isOrganizationWideCustomFieldConflict(
        pgError("23505", 'duplicate key value violates unique constraint "custom_fields_personal_lower_name_unique"'),
      ),
    ).toBe(false);
  });

  it("does not fire on a different SQLSTATE that happens to mention the phrase", () => {
    expect(
      isOrganizationWideCustomFieldConflict(pgError("42501", "already exists in this organization")),
    ).toBe(false);
  });

  it("is safe on every non-error shape", () => {
    for (const v of [null, undefined, "23505", 23505, {}, [], new Error("boom")]) {
      expect(isOrganizationWideCustomFieldConflict(v)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// Operation-specific wording (Custom-field creation outage, 2026-09-22). Both 42501 texts below are the
// EXACT production strings: the RLS refusal (proven by the SQL suite, S23/S24) and the outage error
// (production postgres_logs, 2026-09-22 19:14:10 / 19:16:49 UTC).
// ---------------------------------------------------------------------------------------------------
const RLS_REFUSAL = pgError("42501", 'new row violates row-level security policy for table "custom_fields"');
const NORM_PRIVILEGE = pgError("42501", "permission denied for function custom_field_norm");
const GUARD_CONFLICT = pgError("23505", 'A custom field named "Gender" already exists in this organization.');
const OWNER_CONFLICT = pgError(
  "23505",
  'duplicate key value violates unique constraint "custom_fields_personal_lower_name_unique"',
);
const OPERATIONS: CustomFieldOperation[] = ["create", "update", "delete"];

describe("translateCustomFieldError — a create never says 'modify'", () => {
  it("words an RLS refusal on CREATE as a create", () => {
    const e = translateCustomFieldError(RLS_REFUSAL, "create");
    expect(e.message).toBe(CUSTOM_FIELD_MESSAGES.denied.create);
    expect(e.message).not.toMatch(/modify/i);
    expect((e as { code?: string }).code).toBe("42501");
  });

  it("words the production outage error as a SYSTEM problem, never as the user's permission", () => {
    const e = translateCustomFieldError(NORM_PRIVILEGE, "create");
    expect(e.message).toBe(CUSTOM_FIELD_MESSAGES.privilegeDefect.create);
    expect(e.message).not.toMatch(/modify/i);
    expect(e.message).not.toMatch(/you don't have permission/i);
    expect((e as { privilegeDefect?: boolean }).privilegeDefect).toBe(true);
  });

  it("keeps 'modify' for an UPDATE refused by RLS", () => {
    expect(translateCustomFieldError(RLS_REFUSAL, "update").message).toBe(
      "You don't have permission to modify this custom field.",
    );
  });

  it("says 'delete' for a DELETE refused by RLS (it used to say 'modify')", () => {
    const e = translateCustomFieldError(RLS_REFUSAL, "delete");
    expect(e.message).toBe("You don't have permission to delete this custom field.");
    expect(e.message).not.toMatch(/modify/i);
  });

  it.each(OPERATIONS)("gives a privilege defect on %s that operation's system message", (op) => {
    const e = translateCustomFieldError(NORM_PRIVILEGE, op);
    expect(e.message).toBe(CUSTOM_FIELD_MESSAGES.privilegeDefect[op]);
    expect(e.message).not.toMatch(/you don't have permission/i);
  });

  it.each(OPERATIONS)("leaves duplicate handling unchanged on %s — org-wide conflict text AND marker", (op) => {
    const e = translateCustomFieldError(GUARD_CONFLICT, op);
    expect(e.message).toBe("A custom field with this name already exists in this agency.");
    expect(isOrganizationWideCustomFieldConflict(e)).toBe(true);
  });

  it.each(OPERATIONS)("leaves duplicate handling unchanged on %s — per-owner conflict text", (op) => {
    const e = translateCustomFieldError(OWNER_CONFLICT, op);
    expect(e.message).toBe("A custom field with this name already exists.");
    expect(isOrganizationWideCustomFieldConflict(e)).toBe(false);
  });

  it("passes an unrelated Error through untouched", () => {
    const original = new Error("network down");
    expect(translateCustomFieldError(original, "create")).toBe(original);
  });

  it("turns an unrelated non-Error value into an Error carrying its message", () => {
    const e = translateCustomFieldError({ message: "weird failure" }, "update");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("weird failure");
  });
});

describe("isRowLevelSecurityRefusal / isPrivilegeDefect — the two different 42501s", () => {
  it("tells an RLS refusal from a missing GRANT", () => {
    expect(isRowLevelSecurityRefusal(RLS_REFUSAL)).toBe(true);
    expect(isPrivilegeDefect(RLS_REFUSAL)).toBe(false);
    expect(isPrivilegeDefect(NORM_PRIVILEGE)).toBe(true);
    expect(isRowLevelSecurityRefusal(NORM_PRIVILEGE)).toBe(false);
  });

  it.each([
    "permission denied for table custom_fields",
    "permission denied for schema private",
    "permission denied for relation custom_fields",
    "permission denied for sequence some_seq",
  ])("classifies '%s' as a privilege defect", (message) => {
    expect(isPrivilegeDefect(pgError("42501", message))).toBe(true);
    expect(translateCustomFieldError(pgError("42501", message), "create").message).toBe(
      CUSTOM_FIELD_MESSAGES.privilegeDefect.create,
    );
  });

  it("is safe on every non-error shape", () => {
    for (const v of [null, undefined, "42501", 42501, {}, [], new Error("boom")]) {
      expect(isRowLevelSecurityRefusal(v)).toBe(false);
      expect(isPrivilegeDefect(v)).toBe(false);
    }
  });
});

describe("CustomFieldContextError — refusals raised before any INSERT", () => {
  it("carries the approved mismatch and unverifiable messages", () => {
    const mismatch = new CustomFieldContextError("org_mismatch");
    expect(mismatch.reason).toBe("org_mismatch");
    expect(mismatch.message).toBe(CUSTOM_FIELD_MESSAGES.orgMismatch);
    const unverified = new CustomFieldContextError("org_unverified");
    expect(unverified.reason).toBe("org_unverified");
    expect(unverified.message).toBe(CUSTOM_FIELD_MESSAGES.orgUnverified);
  });

  it("is recognised by isCustomFieldContextError and never mistaken for a database conflict", () => {
    const e = new CustomFieldContextError("org_mismatch");
    expect(isCustomFieldContextError(e)).toBe(true);
    expect(e).toBeInstanceOf(Error);
    expect(isOrganizationWideCustomFieldConflict(e)).toBe(false);
    expect(isCustomFieldContextError(RLS_REFUSAL)).toBe(false);
    expect(isCustomFieldContextError(null)).toBe(false);
  });
});

describe("CUSTOM_FIELD_MESSAGES — the approved wording (D-5), pinned verbatim", () => {
  it("matches the approved table exactly", () => {
    expect(CUSTOM_FIELD_MESSAGES).toEqual({
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
    });
  });

  it("never uses 'modify' outside the update operation", () => {
    const { denied, privilegeDefect, ...rest } = CUSTOM_FIELD_MESSAGES;
    const nonUpdate = [
      denied.create,
      denied.delete,
      privilegeDefect.create,
      privilegeDefect.delete,
      ...Object.values(rest),
    ];
    for (const message of nonUpdate) expect(message).not.toMatch(/modify/i);
  });
});
