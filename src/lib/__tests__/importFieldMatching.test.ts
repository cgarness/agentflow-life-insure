import { describe, it, expect } from "vitest";

import {
  AGENTFLOW_FIELDS,
  DO_NOT_IMPORT,
  buildImportFieldOptions,
  customFieldOptionValue,
  matchCsvHeaderToField,
  normalizeFieldName,
  resolveMappingToCanonicalName,
  type ImportFieldOption,
  type MappableCustomField,
} from "@/lib/import-field-matching";

const cf = (id: string, name: string): MappableCustomField => ({ id, name });

/** Options built from a single custom field named "New Field". */
const newFieldOptions = () => buildImportFieldOptions([cf("cf-1", "New Field")]);

describe("normalizeFieldName", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeFieldName("  New Field  ")).toBe(normalizeFieldName("New Field"));
  });

  it("compares case-insensitively", () => {
    expect(normalizeFieldName("NEW FIELD")).toBe(normalizeFieldName("new field"));
  });

  it("collapses repeated internal whitespace", () => {
    expect(normalizeFieldName("New    Field")).toBe(normalizeFieldName("New Field"));
    expect(normalizeFieldName("New\t\tField")).toBe(normalizeFieldName("New Field"));
  });

  it("preserves meaningful punctuation (does not over-normalize)", () => {
    expect(normalizeFieldName("Date/Time")).not.toBe(normalizeFieldName("Date Time"));
    expect(normalizeFieldName("E-Mail")).not.toBe(normalizeFieldName("EMail"));
  });
});

describe("buildImportFieldOptions — canonical identity vs display label", () => {
  it("keeps the canonical name undecorated while the label carries the UI-only suffix", () => {
    const opts = newFieldOptions();
    const custom = opts.find((o) => o.kind === "custom")!;
    expect(custom.canonicalName).toBe("New Field");
    expect(custom.label).toBe("New Field (Custom)");
    expect(custom.customFieldId).toBe("cf-1");
  });

  it("uses a stable database-id-derived value, never the rendered label", () => {
    const custom = newFieldOptions().find((o) => o.kind === "custom")!;
    expect(custom.value).toBe(customFieldOptionValue("cf-1"));
    expect(custom.value).toContain("cf-1");
    expect(custom.value).not.toContain("(Custom)");
    expect(custom.value).not.toContain("Custom");
  });

  it("emits every built-in field with value === canonicalName === label", () => {
    const opts = buildImportFieldOptions([]);
    for (const name of AGENTFLOW_FIELDS) {
      const o = opts.find((x) => x.canonicalName === name)!;
      expect(o).toBeDefined();
      expect(o.kind).toBe("standard");
      expect(o.value).toBe(name);
      expect(o.label).toBe(name);
    }
  });

  it("marks options ambiguous when two custom fields normalize identically", () => {
    const opts = buildImportFieldOptions([cf("a", "Gender"), cf("b", " gender ")]);
    const genders = opts.filter((o) => o.kind === "custom");
    expect(genders).toHaveLength(2);
    expect(genders.every((o) => o.ambiguous)).toBe(true);
    // Distinct stable values even though the names collide.
    expect(genders[0].value).not.toBe(genders[1].value);
  });

  it("marks a custom field ambiguous when it collides with a built-in field", () => {
    const opts = buildImportFieldOptions([cf("x", "Email")]);
    const custom = opts.find((o) => o.kind === "custom")!;
    expect(custom.ambiguous).toBe(true);
  });
});

describe("matchCsvHeaderToField — auto-detection", () => {
  it("selects the custom field for an exact later-upload header match", () => {
    const opts = newFieldOptions();
    const m = matchCsvHeaderToField("New Field", opts);
    expect(m?.customFieldId).toBe("cf-1");
    expect(m?.value).toBe(customFieldOptionValue("cf-1"));
  });

  it("matches case variations", () => {
    const opts = newFieldOptions();
    expect(matchCsvHeaderToField("new field", opts)?.customFieldId).toBe("cf-1");
    expect(matchCsvHeaderToField("NEW FIELD", opts)?.customFieldId).toBe("cf-1");
    expect(matchCsvHeaderToField("nEw FiElD", opts)?.customFieldId).toBe("cf-1");
  });

  it("matches leading/trailing whitespace variations", () => {
    const opts = newFieldOptions();
    expect(matchCsvHeaderToField("  New Field", opts)?.customFieldId).toBe("cf-1");
    expect(matchCsvHeaderToField("New Field   ", opts)?.customFieldId).toBe("cf-1");
  });

  it("matches repeated internal whitespace", () => {
    const opts = newFieldOptions();
    expect(matchCsvHeaderToField("New   Field", opts)?.customFieldId).toBe("cf-1");
    expect(matchCsvHeaderToField("New\tField", opts)?.customFieldId).toBe("cf-1");
  });

  it("leaves the column unmapped when the normalized match is ambiguous", () => {
    const opts = buildImportFieldOptions([cf("a", "Gender"), cf("b", "gender")]);
    expect(matchCsvHeaderToField("Gender", opts)).toBeNull();
    expect(matchCsvHeaderToField("  GENDER ", opts)).toBeNull();
  });

  it("does not silently select the wrong field on a built-in/custom collision", () => {
    const opts = buildImportFieldOptions([cf("x", "Email")]);
    const m = matchCsvHeaderToField("Email", opts);
    expect(m).toBeNull();
  });

  it("returns null for a header that matches nothing", () => {
    expect(matchCsvHeaderToField("Totally Unrelated Column", newFieldOptions())).toBeNull();
  });

  it("never returns an option whose value contains the UI-only suffix", () => {
    const m = matchCsvHeaderToField("New Field", newFieldOptions());
    expect(m!.value.includes("(Custom)")).toBe(false);
  });
});

describe("matchCsvHeaderToField — built-in auto-detection is unchanged", () => {
  const opts = buildImportFieldOptions([]);

  // Pins the pre-existing fuzzyMatch behaviour exactly (variations, partials, short-code guard).
  const cases: Array<[string, string]> = [
    ["First Name", "First Name"],
    ["firstname", "First Name"],
    ["fname", "First Name"],
    ["Given Name", "First Name"],
    ["Last Name", "Last Name"],
    ["surname", "Last Name"],
    ["Full Name", "Full Name"],
    ["name", "Full Name"],
    ["Phone", "Phone"],
    ["Phone Number", "Phone"],
    ["cell phone", "Phone"],
    ["Mobile", "Phone"],
    ["Email", "Email"],
    ["E-Mail", "Email"],
    ["Email Address", "Email"],
    ["State", "State"],
    ["st", "State"],
    ["Province", "State"],
    ["Lead Source", "Lead Source"],
    ["source", "Lead Source"],
    ["Age", "Age"],
    ["Date of Birth", "Date of Birth"],
    ["DOB", "Date of Birth"],
    ["birthday", "Date of Birth"],
    ["Best Time to Call", "Best Time to Call"],
    ["Notes", "Notes"],
    ["comments", "Notes"],
    ["Assigned Agent", "Assigned Agent"],
    ["agent", "Assigned Agent"],
  ];

  it.each(cases)("maps %s to the %s built-in", (header, expected) => {
    const m = matchCsvHeaderToField(header, opts);
    expect(m?.canonicalName).toBe(expected);
    expect(m?.kind).toBe("standard");
  });

  it("keeps the short-code guard: a 2-letter variation only matches exactly", () => {
    // "st" is a State variation but must not partial-match "street".
    expect(matchCsvHeaderToField("street", opts)?.canonicalName).not.toBe("State");
  });

  it("built-in matches win over a custom field with the same normalized name only when unambiguous", () => {
    // Unrelated custom field present: built-in detection must be untouched.
    const withCustom = buildImportFieldOptions([cf("cf-1", "New Field")]);
    expect(matchCsvHeaderToField("Phone Number", withCustom)?.canonicalName).toBe("Phone");
  });
});

describe("resolveMappingToCanonicalName — payload contract", () => {
  it("resolves a stable custom-field value back to the canonical NAME for the payload", () => {
    const opts = newFieldOptions();
    expect(resolveMappingToCanonicalName(customFieldOptionValue("cf-1"), opts)).toBe("New Field");
  });

  it("resolves a built-in value to itself", () => {
    expect(resolveMappingToCanonicalName("Phone", buildImportFieldOptions([]))).toBe("Phone");
  });

  it("never resolves to a decorated label", () => {
    const opts = newFieldOptions();
    const resolved = resolveMappingToCanonicalName(customFieldOptionValue("cf-1"), opts)!;
    expect(resolved).not.toContain("(Custom)");
  });

  it("returns null for the do-not-import sentinel and for unknown values", () => {
    const opts = newFieldOptions();
    expect(resolveMappingToCanonicalName(DO_NOT_IMPORT, opts)).toBeNull();
    expect(resolveMappingToCanonicalName("custom:deleted-id", opts)).toBeNull();
  });
});
