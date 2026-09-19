/**
 * The organization-wide logical-name guard and the two pre-existing per-owner unique
 * indexes all raise SQLSTATE 23505, but they mean different things. Misclassifying them
 * makes the UI tell a user "you already have this" about a field that belongs to someone
 * else and that RLS hides from them — and, worse, would let the import map into a
 * definition the importer cannot resolve. These cases pin the discrimination.
 */
import { describe, it, expect } from "vitest";

import { isOrganizationWideCustomFieldConflict } from "@/lib/custom-field-errors";

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
