import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mappingV2Active, mappingV2FlagOn, serverSupportsMappingV2 } from "../mappingGate";
import { buildFieldCatalog, searchCatalog, unmappedRequiredFields } from "../fieldCatalog";
import { autoMap, autoMapV2 } from "../autoMap";
import { applyColumnChoice, buildHeaderState, dropMissing, headerColumns, IGNORE_TARGET, reconcileIgnored } from "../headerState";
import { sourceDraftV2Schema, STANDARD_FIELDS, toPayloadV2, type CatalogField, type SourceDraftV2 } from "../schema";
import { STANDARD_LEAD_FIELDS } from "@/lib/standard-lead-fields";
import { STANDARD_TARGETS, validateMapping } from "../../../../supabase/functions/_shared/googleSheets/mapping";

afterEach(() => vi.unstubAllEnvs());

const ME = "u-me", OTHER = "u-other";
const f = (id: string, name: string, extra: Partial<CatalogField> = {}): CatalogField =>
  ({ id, name, created_by: ME, created_at: "2026-08-01T00:00:00Z", type: "Text", scope: "personal", own: true, ...extra });
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AGENT_CTX = { custom_fields: [
  f(ID(1), "Address", { created_by: null, scope: "agency", own: false }), f(ID(2), "City", { created_by: null, scope: "agency", own: false }),
  f(ID(3), "ZIP Code", { created_by: null, scope: "agency", own: false }), f(ID(4), "Amt Requested", { type: "Number" }),
  f(ID(5), "Email", { created_by: null, scope: "agency", own: false }), f(ID(6), "Tags", { created_by: null, scope: "agency", own: false }),
  f(ID(7), "Received", { type: "Date", required: true }),
] };

describe("mapping v2 gate (G1 build flag ∧ G2 server capability)", () => {
  it("is off unless BOTH the flag and the server's mapping_versions include 2", () => {
    expect(mappingV2FlagOn()).toBe(false);
    vi.stubEnv("VITE_GOOGLE_SHEETS_MAPPING_V2", "true");
    expect(mappingV2FlagOn()).toBe(true);
    vi.stubEnv("VITE_GOOGLE_SHEETS_MAPPING_V2", "1");
    expect(mappingV2FlagOn()).toBe(false);
    for (const [flag, ctx, out] of [[true, { mapping_versions: [1, 2] }, true], [true, { mapping_versions: [1] }, false], [true, {}, false],
      [true, null, false], [false, { mapping_versions: [1, 2] }, false]] as [boolean, { mapping_versions?: number[] } | null, boolean][]) {
      expect(mappingV2Active(flag, ctx)).toBe(out);
    }
    expect(serverSupportsMappingV2(undefined)).toBe(false);
  });
});

describe("field catalog", () => {
  it("groups every visible field; address group resolves the standard fields; nothing is dropped silently", () => {
    const c = buildFieldCatalog(AGENT_CTX, ME);
    const byGroup = (g: string) => c.options.filter((o) => o.group === g).map((o) => o.label);
    expect(byGroup("required")).toEqual(["First Name", "Last Name", "Full Name", "Phone"]);
    expect(byGroup("address")).toEqual(["Address", "City", "ZIP Code"]);
    expect(byGroup("mine")).toEqual(["Amt Requested", "Received"]);
    expect(byGroup("unavailable")).toEqual(["Email", "Tags"]);
    expect(c.options.find((o) => o.label === "Email" && o.group === "unavailable")?.reason).toMatch(/built-in/);
    expect(c.options.find((o) => o.label === "Tags")?.reason).toMatch(/Reserved/);
    expect(c.missingStandard).toEqual([]);
    expect(c.byValue.get(`custom:${ID(4)}`)?.type).toBe("Number");
  });

  it("an Admin sees other users' personal fields labelled; a personal standard field explains itself; missing standard fields are offered", () => {
    const c = buildFieldCatalog({ custom_fields: [f(ID(8), "Zip Code", { created_by: OTHER, own: false }), f(ID(9), "Notes 2", { created_by: OTHER, own: false })] }, ME);
    expect(c.options.find((o) => o.label === "Zip Code")).toMatchObject({ group: "address", standardKey: "zip_code", reason: "Another user's personal field" });
    expect(c.options.find((o) => o.label === "Notes 2")?.group).toBe("others");
    expect(c.missingStandard.map((m) => m.name)).toEqual(["Address", "City"]);
    const mine = buildFieldCatalog({ custom_fields: [f(ID(8), "City")] }, ME);
    expect(mine.options.find((o) => o.label === "City")?.reason).toMatch(/only you can use it/);
  });

  it("an older catalog (no typed keys) still groups by ownership", () => {
    const c = buildFieldCatalog({ custom_fields: [{ id: ID(1), name: "Gender", created_by: null, created_at: null }, { id: ID(2), name: "Mine", created_by: ME, created_at: null }] }, ME);
    expect(c.options.filter((o) => o.value.startsWith("custom:")).map((o) => [o.label, o.group])).toEqual([["Gender", "agency"], ["Mine", "mine"]]);
  });

  it("search ignores case, spaces and punctuation; required fields left out are reported", () => {
    const c = buildFieldCatalog(AGENT_CTX, ME);
    expect(searchCatalog(c.options, "zip").map((o) => o.label)).toEqual(["ZIP Code"]);
    expect(searchCatalog(c.options, "amtreq").map((o) => o.label)).toEqual(["Amt Requested"]);
    expect(searchCatalog(c.options, "").length).toBe(c.options.length);
    expect(unmappedRequiredFields(AGENT_CTX, ["phone"])).toEqual(["Received"]);
    expect(unmappedRequiredFields(AGENT_CTX, [`custom:${ID(7)}`])).toEqual([]);
  });
});

describe("auto-detection v2 (the CSV mapper is unchanged)", () => {
  const cat = buildFieldCatalog(AGENT_CTX, ME);
  it("routes address headers to the standard fields and never to Email", () => {
    const headers = ["First Name", "Last Name", "Phone", "Mailing Address", "Mailing City", "Zip", "Mailing State", "Mailing List", "Amt. Requested", "Lead ID"];
    const r = autoMapV2(headers, cat, AGENT_CTX.custom_fields);
    expect(r.idHeader).toBe("Lead ID");
    expect(Object.fromEntries(r.columns.map((c) => [c.header, c.target]))).toEqual({
      "First Name": "first_name", "Last Name": "last_name", Phone: "phone", "Mailing Address": `custom:${ID(1)}`, "Mailing City": `custom:${ID(2)}`,
      Zip: `custom:${ID(3)}`, "Mailing State": "state", "Amt. Requested": `custom:${ID(4)}`,
    });
    // The legacy detector still maps "Mailing Address" to Email: v2 must not inherit that.
    expect(autoMap(["Mailing Address"], []).columns).toEqual([{ header: "Mailing Address", target: "email" }]);
  });
  it("leaves an address column unmapped when the agency has no such field, and uses each target once", () => {
    const r = autoMapV2(["Postal Code", "Street Address", "City", "Town"], buildFieldCatalog({ custom_fields: [f(ID(2), "City", { created_by: null, scope: "agency" })] }, ME), []);
    expect(r.columns).toEqual([{ header: "City", target: `custom:${ID(2)}` }]);
  });
});

describe("header state and draft helpers", () => {
  const headers = { header: ["First", "Last", "Phone", "", "Phone ", "Address", "City"], columns: undefined as never,
    over_limit: { count: 2, headers: ["Spouse", "Policy"] } };
  it("lists blank-with-data, duplicate, new and missing columns; derives flags for an older server", () => {
    const cols = headerColumns({ header: headers.header });
    expect(cols.map((c) => [c.letter, c.blank, c.duplicate])).toEqual([["A", false, false], ["B", false, false], ["C", false, true], ["D", true, false],
      ["E", false, true], ["F", false, false], ["G", false, false]]);
    const v2 = { header: headers.header, over_limit: headers.over_limit, columns: cols.map((c) => ({ ...c, has_data: c.index === 3 })) };
    const s = buildHeaderState(v2, { columns: [{ header: "First", target: "first_name" }, { header: "Gone", target: "notes" }], ignored: ["Address"] },
      [{ header: "Phone", target: "phone" }]);
    expect(s.columns.map((c) => `${c.letter}:${c.status}`)).toEqual(["A:ready", "B:new", "C:duplicate", "D:blank_data", "E:duplicate", "F:ready", "G:new"]);
    expect(s.missing).toEqual([{ header: "Gone", target: "notes" }]);
    expect(s.duplicatedMapped).toEqual(["Phone"]);
    expect(s.overLimit.count).toBe(2);
    expect(s.mappableHeaders).toEqual(["First", "Last", "Address", "City"]);
  });

  it("every unmapped column is explicitly ignored; the acknowledgement resets when that set changes", () => {
    const base = { idHeader: null, columns: [{ header: "First", target: "first_name" }], ignored: [] as string[], acknowledged: false };
    const mappable = ["First", "Last", "Address"];
    let d = reconcileIgnored(base, mappable);
    expect(d.ignored).toEqual(["Last", "Address"]);
    d = { ...d, acknowledged: true };
    expect(reconcileIgnored(d, mappable).acknowledged).toBe(true);
    d = applyColumnChoice(d, "Last", "last_name", mappable);
    expect([d.ignored, d.acknowledged]).toEqual([["Address"], false]);
    d = applyColumnChoice({ ...d, acknowledged: true }, "Address", "last_name", mappable);   // a confirmed move
    expect(d.columns).toEqual([{ header: "First", target: "first_name" }, { header: "Address", target: "last_name" }]);
    expect(d.ignored).toEqual(["Last"]);
    d = applyColumnChoice(d, "Address", IGNORE_TARGET, mappable);
    expect(d.ignored).toEqual(["Last", "Address"]);
    expect(dropMissing({ ...base, columns: [...base.columns, { header: "Gone", target: "notes" }] }, [{ header: "Gone", target: "notes" }], mappable).columns)
      .toEqual([{ header: "First", target: "first_name" }]);
  });

  it("the v2 form schema requires phone + name, existing headers, every column decided and the acknowledgement", () => {
    const sheet = ["Name", "Phone", "Address"];
    const ok: SourceDraftV2 = { displayName: "X", leadSourceDefault: "Google Sheets", idHeader: null, includeExisting: false,
      columns: [{ header: "Name", target: "full_name" }, { header: "Phone", target: "phone" }], ignored: ["Address"], acknowledged: true };
    expect(sourceDraftV2Schema(sheet).safeParse(ok).success).toBe(true);
    const msg = (d: Partial<SourceDraftV2>) => { const r = sourceDraftV2Schema(sheet).safeParse({ ...ok, ...d }); return r.success ? [] : r.error.issues.map((i) => i.message); };
    expect(msg({ acknowledged: false })).toEqual(["Confirm the columns that won't be imported"]);
    expect(msg({ ignored: [] })[0]).toMatch(/Choose a field or "Don't import" for: Address/);
    expect(msg({ columns: [...ok.columns, { header: "Gone", target: "notes" }] })[0]).toMatch(/"Gone" is no longer in the sheet/);
    expect(msg({ columns: [{ header: "Name", target: "full_name" }] })).toContain("Map a Phone column");
    expect(msg({ ignored: ["Address", "Phone"] })).toContain("A column can't be both imported and ignored");
  });
});

describe("frontend ↔ backend contract parity", () => {
  it("field keys, v2 payloads and the standard catalog agree with the Edge validator and the SQL migration", () => {
    expect(STANDARD_FIELDS.map((s) => s.key)).toEqual([...STANDARD_TARGETS]);
    const draft: SourceDraftV2 = { displayName: "X", leadSourceDefault: "Sheets", idHeader: null, includeExisting: false,
      columns: [{ header: "Name", target: "full_name" }, { header: "Phone", target: "phone" }, { header: "Zip", target: `custom:${ID(3)}` }],
      ignored: ["Address"], acknowledged: true };
    const payload = toPayloadV2(draft, { spreadsheetId: "S", sheetId: 0, spreadsheetName: "S", sheetTitle: "T" });
    expect(validateMapping(payload.mapping)).toEqual({ ok: true, mapping: payload.mapping });
    const sql = readFileSync(resolve(__dirname, "../../../../supabase/migrations/pending/20261028120100_standard_lead_fields.sql"), "utf8");
    const rows = [...sql.matchAll(/\('(\w+)', '([^']+)', '(\w+)', '\["Leads"\]'::jsonb\)/g)].map((m) => ({ key: m[1], name: m[2], type: m[3] }));
    expect(rows).toEqual(STANDARD_LEAD_FIELDS.map((s) => ({ key: s.key, name: s.name, type: s.type })));
  });
});
