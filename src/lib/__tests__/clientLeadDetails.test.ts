import { describe, expect, it } from "vitest";
import {
  clientDobEditor,
  formatSpouseInfo,
  isEditableSpouseInfo,
  optionsWithCurrent,
  parseLeadConversion,
  validateChangedClientPersonFields,
} from "@/lib/clientLeadDetails";

const stored = {
  version: 1, lead_id: "lead-1", converted_at: "2026-10-21T20:00:00+00:00", converted_by: "agent-1",
  lead_status: "Interested", lead_source: "Facebook", lead_score: 8, lead_created_at: "2026-09-01T12:00:00+00:00",
  lead_last_contacted_at: null, lead_owner_id: "agent-1", lead_assigned_agent_id: "agent-1", lead_imported_by_user_id: null,
};

describe("parseLeadConversion — protected history from clients.lead_conversion", () => {
  it("reads the stored history; lead score is kept in storage but never surfaced", () => {
    const h = parseLeadConversion(stored);
    expect(h).toEqual({
      version: 1, leadId: "lead-1", convertedAt: "2026-10-21T20:00:00+00:00", convertedBy: "agent-1",
      leadStatus: "Interested", leadSource: "Facebook", leadCreatedAt: "2026-09-01T12:00:00+00:00",
      leadLastContactedAt: null, leadNotes: null, hasPreservedCustomFields: false,
    });
    expect(JSON.stringify(h)).not.toContain("score");
  });

  it("surfaces displaced lead notes and set-aside custom data", () => {
    const h = parseLeadConversion({ ...stored, lead_notes: "Original notes", preserved_custom_fields: { additional_policies: "x" } });
    expect(h?.leadNotes).toBe("Original notes");
    expect(h?.hasPreservedCustomFields).toBe(true);
  });

  it.each([
    ["absent (historical or manual client)", undefined],
    ["SQL NULL", null],
    ["a string", "corrupt"],
    ["an array", []],
    ["an unknown version", { ...stored, version: 2 }],
    ["missing lineage", { ...stored, lead_id: undefined }],
  ])("hides the panel when the value is %s — never throws", (_label, raw) => {
    expect(parseLeadConversion(raw)).toBeUndefined();
  });

  it("treats blank text as missing and tolerates unknown extra keys", () => {
    const h = parseLeadConversion({ ...stored, lead_source: "  ", future_key: { anything: true } });
    expect(h?.leadSource).toBeNull();
    expect(h?.leadStatus).toBe("Interested");
  });
});

describe("spouse info", () => {
  it("only text (or nothing) is editable; structured values stay read-only", () => {
    expect(isEditableSpouseInfo(undefined)).toBe(true);
    expect(isEditableSpouseInfo(null)).toBe(true);
    expect(isEditableSpouseInfo("Jane, 58")).toBe(true);
    expect(isEditableSpouseInfo({ name: "Pat" })).toBe(false);
    expect(isEditableSpouseInfo(["Pat"])).toBe(false);
    expect(isEditableSpouseInfo(42)).toBe(false);
  });

  it("formats any stored shape for display without losing values", () => {
    expect(formatSpouseInfo("Jane, 58")).toBe("Jane, 58");
    expect(formatSpouseInfo({ name: "Pat", age: 60, note: "" })).toBe("name: Pat · age: 60");
    expect(formatSpouseInfo({ name: "Pat", kids: { count: 2 } })).toBe('name: Pat · kids: {"count":2}');
    expect(formatSpouseInfo(["Pat", "Lee"])).toBe("Pat, Lee");
    expect(formatSpouseInfo(null)).toBe("");
  });
});

describe("editors keep legacy values visible", () => {
  it("edits a DOB the date picker cannot show as plain text", () => {
    expect(clientDobEditor("1961-04-12")).toBe("date");
    expect(clientDobEditor(undefined)).toBe("date");
    expect(clientDobEditor("")).toBe("date");
    expect(clientDobEditor("03/04/1960")).toBe("text");
    expect(clientDobEditor("1961-02-30")).toBe("text");
  });

  it("keeps a stored option selectable", () => {
    expect(optionsWithCurrent(["Anytime"], "Morning")).toEqual(["Anytime", "Morning"]);
    expect(optionsWithCurrent(["Anytime"], "Anytime")).toEqual(["Anytime"]);
    expect(optionsWithCurrent(["Anytime"], undefined)).toEqual(["Anytime"]);
  });
});

describe("validateChangedClientPersonFields (Zod) — only what the agent changed", () => {
  const legacy = { dateOfBirth: "03/04/1960", age: 140, bestTimeToCall: "x".repeat(150), spouseInfo: { name: "Pat" } };

  it("never blocks an unrelated save because of a legacy value", () => {
    expect(validateChangedClientPersonFields(legacy, { ...legacy })).toEqual([]);
    expect(validateChangedClientPersonFields({}, {})).toEqual([]);
  });

  it("accepts valid edits, clearing, and numeric strings from the number input", () => {
    expect(validateChangedClientPersonFields({}, { dateOfBirth: "1970-01-02", age: 55, bestTimeToCall: "Anytime", spouseInfo: "Jamie" })).toEqual([]);
    expect(validateChangedClientPersonFields({ age: 55, dateOfBirth: "1970-01-02" }, { age: "" as never, dateOfBirth: "" })).toEqual([]);
    expect(validateChangedClientPersonFields({}, { age: "47" as never })).toEqual([]);
  });

  it("refuses an impossible or future DOB, a bad age and oversize text", () => {
    expect(validateChangedClientPersonFields({}, { dateOfBirth: "1970-02-30" })).toEqual(["Date of birth must be a real date (YYYY-MM-DD) that is not in the future."]);
    expect(validateChangedClientPersonFields({}, { dateOfBirth: "2999-01-01" })).toHaveLength(1);
    expect(validateChangedClientPersonFields({}, { age: 131 })).toEqual(["Age must be a whole number from 0 to 130."]);
    expect(validateChangedClientPersonFields({}, { age: 4.5 })).toHaveLength(1);
    expect(validateChangedClientPersonFields({}, { spouseInfo: "x".repeat(501) })).toEqual(["Spouse info must be 500 characters or fewer."]);
  });

  it("reports only the changed field when a legacy neighbour is also invalid", () => {
    expect(validateChangedClientPersonFields(legacy, { ...legacy, age: 200 })).toEqual(["Age must be a whole number from 0 to 130."]);
  });
});
