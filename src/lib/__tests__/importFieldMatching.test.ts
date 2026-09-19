import { describe, it, expect } from "vitest";

import {
  AGENTFLOW_FIELDS,
  CREATE_NEW_FIELD,
  DO_NOT_IMPORT,
  buildImportFieldOptions,
  buildLogicalCustomFields,
  classifyRequestedFieldName,
  customFieldOptionValue,
  findOptionByFieldName,
  matchCsvHeaderToField,
  normalizeFieldName,
  resolveMappingToCanonicalName,
  type ImportFieldOption,
  type MappableCustomField,
} from "@/lib/import-field-matching";

const cf = (
  id: string,
  name: string,
  extra: Partial<MappableCustomField> = {},
): MappableCustomField => ({ id, name, ...extra });

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

  // INVERTED by the Custom-Field Canonicalization build. Duplicate physical rows that
  // normalize identically are ONE logical field, not an ambiguity.
  it("collapses two custom fields that normalize identically into ONE option", () => {
    const opts = buildImportFieldOptions([cf("a", "Gender"), cf("b", " gender ")]);
    const genders = opts.filter((o) => o.kind === "custom");
    expect(genders).toHaveLength(1);
    expect(genders[0].ambiguous).toBe(false);
    // Both physical rows remain reachable through the logical option.
    expect([...genders[0].memberIds!].sort()).toEqual(["a", "b"]);
  });

  it("collapses THREE physical rows of one name into ONE option (the production shape)", () => {
    const opts = buildImportFieldOptions([
      cf("a", "Gender", { scope: "personal", createdBy: "u1", createdAt: "2026-08-04T18:31:30Z" }),
      cf("b", "Gender", { scope: "personal", createdBy: "u2", createdAt: "2026-08-05T16:05:05Z" }),
      cf("c", "Gender", { scope: "personal", createdBy: "u3", createdAt: "2026-08-05T18:57:41Z" }),
    ]);
    const genders = opts.filter((o) => o.kind === "custom");
    expect(genders).toHaveLength(1);
    expect(genders[0].canonicalName).toBe("Gender");
    expect(genders[0].memberIds).toHaveLength(3);
  });

  it("keeps DIFFERENT normalized names as separate options", () => {
    const opts = buildImportFieldOptions([cf("a", "Date/Time"), cf("b", "Date Time")]);
    expect(opts.filter((o) => o.kind === "custom")).toHaveLength(2);
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

  // INVERTED by the Custom-Field Canonicalization build: physical duplicates that resolve
  // to the SAME canonical normalized name no longer make a header ambiguous.
  it("auto-matches despite physical duplicates of the same canonical name", () => {
    const opts = buildImportFieldOptions([cf("a", "Gender"), cf("b", "gender"), cf("c", "  GENDER  ")]);
    for (const header of ["Gender", "  GENDER ", "gender", "Gender   "]) {
      const m = matchCsvHeaderToField(header, opts);
      expect(m, `header ${JSON.stringify(header)} should auto-match`).not.toBeNull();
      expect(m!.canonicalName.toLowerCase().trim()).toBe("gender");
    }
  });

  it("still fails closed on TRUE ambiguity — a custom field shadowing a built-in", () => {
    const opts = buildImportFieldOptions([cf("a", "Email"), cf("b", "email")]);
    expect(matchCsvHeaderToField("Email", opts)).toBeNull();
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

// =====================================================================================================
// Custom-Field Canonicalization — the logical registry.
// =====================================================================================================

describe("buildLogicalCustomFields — deterministic representative selection", () => {
  const AGENCY = { scope: "agency" as const, createdBy: null, createdAt: "2026-09-01T00:00:00Z" };
  const p = (createdBy: string, createdAt: string) => ({
    scope: "personal" as const,
    createdBy,
    createdAt,
  });

  it("prefers an AGENCY-wide row over any personal row, however old", () => {
    const rows = [
      cf("p-old", "Gender", p("u1", "2020-01-01T00:00:00Z")),
      cf("a-new", "Gender", AGENCY),
    ];
    const [logical] = buildLogicalCustomFields(rows);
    expect(logical.representativeId).toBe("a-new");
  });

  it("falls back to the OLDEST createdAt among personal rows", () => {
    const rows = [
      cf("c", "Gender", p("u3", "2026-08-05T18:57:41Z")),
      cf("a", "Gender", p("u1", "2026-08-04T18:31:30Z")),
      cf("b", "Gender", p("u2", "2026-08-05T16:05:05Z")),
    ];
    expect(buildLogicalCustomFields(rows)[0].representativeId).toBe("a");
  });

  it("sorts a missing/unparseable createdAt LAST so it can never win by accident", () => {
    const rows = [
      cf("no-date", "Gender", { scope: "personal", createdBy: "u9" }),
      cf("dated", "Gender", p("u1", "2026-08-04T18:31:30Z")),
    ];
    expect(buildLogicalCustomFields(rows)[0].representativeId).toBe("dated");

    const garbage = [
      cf("bad", "Gender", { scope: "personal", createdBy: "u9", createdAt: "not-a-date" }),
      cf("good", "Gender", p("u1", "2026-08-04T18:31:30Z")),
    ];
    expect(buildLogicalCustomFields(garbage)[0].representativeId).toBe("good");
  });

  it("breaks a remaining tie on the lowest id", () => {
    const rows = [
      cf("zzz", "Gender", p("u2", "2026-08-04T18:31:30Z")),
      cf("aaa", "Gender", p("u1", "2026-08-04T18:31:30Z")),
    ];
    expect(buildLogicalCustomFields(rows)[0].representativeId).toBe("aaa");
  });

  it("is INDEPENDENT OF INPUT ORDER — getAll sorts by name only, so array position is not stable", () => {
    const rows = [
      cf("c", "Gender", p("u3", "2026-08-05T18:57:41Z")),
      cf("a", "Gender", p("u1", "2026-08-04T18:31:30Z")),
      cf("b", "Gender", p("u2", "2026-08-05T16:05:05Z")),
    ];
    const permutations = [
      [rows[0], rows[1], rows[2]],
      [rows[2], rows[1], rows[0]],
      [rows[1], rows[2], rows[0]],
      [rows[2], rows[0], rows[1]],
    ];
    for (const perm of permutations) {
      const [logical] = buildLogicalCustomFields(perm);
      expect(logical.representativeId).toBe("a");
      expect([...logical.memberIds]).toEqual(["a", "b", "c"]);
    }
  });

  it("does not reorder the caller's array", () => {
    const rows = [cf("z", "Gender"), cf("a", "Gender")];
    const snapshot = rows.map((r) => r.id);
    buildLogicalCustomFields(rows);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });

  it("groups different users owning the same legacy name into one logical field", () => {
    const rows = [
      cf("a", "Gender", p("admin", "2026-08-04T18:31:30Z")),
      cf("b", "Gender", p("agent-1", "2026-08-05T16:05:05Z")),
      cf("c", "Gender", p("agent-2", "2026-08-05T18:57:41Z")),
    ];
    const logical = buildLogicalCustomFields(rows);
    expect(logical).toHaveLength(1);
    expect(logical[0].canonicalName).toBe("Gender");
    expect(logical[0].normalizedName).toBe("gender");
  });
});

describe("resolveMappingToCanonicalName — logical group resolution", () => {
  it("resolves a mapping stored against a NON-REPRESENTATIVE member", () => {
    // "a" is the representative (oldest); a mapping made earlier against "c" must still
    // resolve, or the payload builder would silently DROP that column from every row.
    const opts = buildImportFieldOptions([
      cf("a", "Gender", { scope: "personal", createdBy: "u1", createdAt: "2026-08-04T00:00:00Z" }),
      cf("c", "Gender", { scope: "personal", createdBy: "u3", createdAt: "2026-08-06T00:00:00Z" }),
    ]);
    expect(resolveMappingToCanonicalName(customFieldOptionValue("c"), opts)).toBe("Gender");
    expect(resolveMappingToCanonicalName(customFieldOptionValue("a"), opts)).toBe("Gender");
  });

  it("still returns null for a custom id that belongs to no option", () => {
    const opts = newFieldOptions();
    expect(resolveMappingToCanonicalName(customFieldOptionValue("ghost"), opts)).toBeNull();
  });

  it("resolves to the canonical NAME and never to a decorated label", () => {
    const opts = buildImportFieldOptions([cf("a", "Gender"), cf("b", "gender")]);
    const name = resolveMappingToCanonicalName(customFieldOptionValue("b"), opts);
    expect(name).toBe("Gender");
    expect(name).not.toContain("(Custom)");
  });
});

describe("findOptionByFieldName — reuse before create", () => {
  it("finds an existing logical custom field regardless of case and whitespace", () => {
    const opts = buildImportFieldOptions([cf("a", "Gender")]);
    for (const requested of ["gender", "  GENDER  ", "Gender", "Gen der   ".replace("Gen der", "Gender")]) {
      expect(findOptionByFieldName(requested, opts, "custom")?.canonicalName).toBe("Gender");
    }
  });

  it("matches across a collapsed duplicate group, whichever row is representative", () => {
    const opts = buildImportFieldOptions([
      cf("b", "gender", { scope: "personal", createdBy: "u2", createdAt: "2026-08-06T00:00:00Z" }),
      cf("a", "Gender", { scope: "personal", createdBy: "u1", createdAt: "2026-08-04T00:00:00Z" }),
    ]);
    const hit = findOptionByFieldName("GENDER", opts, "custom");
    expect(hit?.customFieldId).toBe("a");
    expect(hit?.memberIds).toContain("b");
  });

  it("finds a built-in so a custom field can never shadow one", () => {
    const opts = buildImportFieldOptions([]);
    expect(findOptionByFieldName("date of birth", opts, "standard")?.canonicalName).toBe("Date of Birth");
    expect(findOptionByFieldName("  PHONE ", opts, "standard")?.canonicalName).toBe("Phone");
  });

  it("returns null when nothing matches", () => {
    expect(findOptionByFieldName("Totally New", buildImportFieldOptions([]), "custom")).toBeNull();
  });

  it("keeps punctuation meaningful", () => {
    const opts = buildImportFieldOptions([cf("a", "Date/Time")]);
    expect(findOptionByFieldName("Date/Time", opts, "custom")?.canonicalName).toBe("Date/Time");
    expect(findOptionByFieldName("Date Time", opts, "custom")).toBeNull();
  });
});

describe("tenant isolation at the option layer", () => {
  it("only ever sees the rows it is given — one organization's list cannot leak into another", () => {
    // getAll is org-filtered, so the mapper is handed one organization's rows. Two orgs each
    // holding "Gender" produce independent option lists that share no identity.
    const orgA = buildImportFieldOptions([cf("org-a-gender", "Gender")]);
    const orgB = buildImportFieldOptions([cf("org-b-gender", "Gender")]);
    expect(matchCsvHeaderToField("Gender", orgA)!.customFieldId).toBe("org-a-gender");
    expect(matchCsvHeaderToField("Gender", orgB)!.customFieldId).toBe("org-b-gender");
    expect(resolveMappingToCanonicalName(customFieldOptionValue("org-a-gender"), orgB)).toBeNull();
  });
});

describe("Do Not Import and the create sentinel are unchanged", () => {
  it("never resolves the sentinels to a field name", () => {
    const opts = newFieldOptions();
    expect(resolveMappingToCanonicalName(DO_NOT_IMPORT, opts)).toBeNull();
    expect(resolveMappingToCanonicalName(CREATE_NEW_FIELD, opts)).toBeNull();
    expect(resolveMappingToCanonicalName("", opts)).toBeNull();
  });

  it("emits neither sentinel as a selectable option", () => {
    const opts = newFieldOptions();
    expect(opts.some((o) => o.value === DO_NOT_IMPORT)).toBe(false);
    expect(opts.some((o) => o.value === CREATE_NEW_FIELD)).toBe(false);
  });
});

// =====================================================================================================
// classifyRequestedFieldName — the ONE creation rule, shared by the CSV mapper and Settings.
// =====================================================================================================

describe("classifyRequestedFieldName", () => {
  it("reports a built-in so a custom field can never shadow one", () => {
    for (const requested of ["Date of Birth", "date of birth", "  PHONE  ", "First   Name"]) {
      const v = classifyRequestedFieldName(requested, []);
      expect(v.kind, requested).toBe("builtin");
    }
    expect(classifyRequestedFieldName("email", [])).toEqual({ kind: "builtin", builtInName: "Email" });
  });

  it("reports an existing custom field across case and whitespace variants", () => {
    const rows = [cf("cf-1", "Gender")];
    for (const requested of ["Gender", "gender", "GENDER", " Gender ", "Gender   "]) {
      const v = classifyRequestedFieldName(requested, rows);
      expect(v.kind, requested).toBe("existing");
      if (v.kind === "existing") expect(v.field.id).toBe("cf-1");
    }
  });

  it("reports the LOGICAL representative when duplicates exist", () => {
    const rows = [
      cf("cf-late", "Gender", { scope: "personal", createdBy: "u2", createdAt: "2026-08-06T00:00:00Z" }),
      cf("cf-old", "Gender", { scope: "personal", createdBy: "u1", createdAt: "2026-08-04T00:00:00Z" }),
    ];
    const v = classifyRequestedFieldName("gender", rows);
    expect(v.kind).toBe("existing");
    if (v.kind === "existing") expect(v.field.id).toBe("cf-old");
  });

  it("reports a different user's field as existing — the namespace is the whole agency", () => {
    const rows = [cf("theirs", "Gender", { scope: "personal", createdBy: "another-user" })];
    expect(classifyRequestedFieldName("Gender", rows).kind).toBe("existing");
  });

  it("reports available when nothing collides", () => {
    expect(classifyRequestedFieldName("Favourite Hobby", [cf("cf-1", "Gender")])).toEqual({ kind: "available" });
  });

  it("keeps punctuation meaningful", () => {
    const rows = [cf("cf-1", "Date/Time")];
    expect(classifyRequestedFieldName("Date/Time", rows).kind).toBe("existing");
    expect(classifyRequestedFieldName("Date Time", rows).kind).toBe("available");
  });

  it("excludes the row being renamed, so a no-op re-save is allowed", () => {
    const rows = [cf("cf-1", "Gender")];
    expect(classifyRequestedFieldName("Gender", rows, { excludeId: "cf-1" })).toEqual({ kind: "available" });
    expect(classifyRequestedFieldName("Gender", rows, { excludeId: "other" }).kind).toBe("existing");
  });

  it("honours the eligibility predicate, so inactive rows do not hold a name hostage", () => {
    const rows = [{ ...cf("cf-1", "Gender"), active: false } as any];
    const v = classifyRequestedFieldName("Gender", rows, { isEligible: (f: any) => f.active !== false });
    expect(v).toEqual({ kind: "available" });
  });

  it("checks built-ins BEFORE custom fields, so a shadowing row cannot win", () => {
    const rows = [cf("shadow", "Email")];
    expect(classifyRequestedFieldName("Email", rows).kind).toBe("builtin");
  });
});
