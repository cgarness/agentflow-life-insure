import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mappingV2Active, mappingV2FlagOn, serverSupportsMappingV2 } from "../mappingGate";
import { buildFieldCatalog, searchCatalog, unmappedRequiredFields } from "../fieldCatalog";
import { autoMap, autoMapV2 } from "../autoMap";
import { applyColumnChoice, buildHeaderState, dropMissing, headerColumns, IGNORE_TARGET, reconcileIgnored } from "../headerState";
import { sourceDraftV2Schema, STANDARD_FIELDS, toPayloadV2, type CatalogField, type NotImportable, type PreviewResult, type SourceDraftV2 } from "../schema";
import { acknowledgementToken, isColumnsError, notImportableLines, previewKey, previewRequest, saveBlockers, type PreviewState } from "../previewGate";
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
    beyond_limit: { width: 260, checked_through: 260, unchecked: false, columns: [{ letter: "GS", header: "Spouse", has_data: true }, { letter: "GU", header: "", has_data: true }] } };
  it("lists blank-with-data, duplicate, new and missing columns; derives flags for an older server", () => {
    const cols = headerColumns({ header: headers.header });
    expect(cols.map((c) => [c.letter, c.blank, c.duplicate])).toEqual([["A", false, false], ["B", false, false], ["C", false, true], ["D", true, false],
      ["E", false, true], ["F", false, false], ["G", false, false]]);
    const v2 = { header: headers.header, beyond_limit: headers.beyond_limit, columns: cols.map((c) => ({ ...c, has_data: c.index === 3 })) };
    const s = buildHeaderState(v2, { columns: [{ header: "First", target: "first_name" }, { header: "Gone", target: "notes" }], ignored: ["Address"] },
      [{ header: "Phone", target: "phone" }]);
    expect(s.columns.map((c) => `${c.letter}:${c.status}`)).toEqual(["A:ready", "B:new", "C:duplicate", "D:blank_data", "E:duplicate", "F:ready", "G:new"]);
    expect(s.missing).toEqual([{ header: "Gone", target: "notes" }]);
    expect(s.duplicatedMapped).toEqual(["Phone"]);
    expect(s.beyondLimit?.columns.map((c) => c.letter)).toEqual(["GS", "GU"]);
    expect(buildHeaderState({ header: ["A"] }, null, []).beyondLimit).toBeNull();
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
    // content no mapping can import (from the preview) needs the acknowledgement even when nothing is ignored
    const allMapped = { ...ok, columns: [...ok.columns, { header: "Address", target: "notes" }], ignored: [], acknowledged: false };
    expect(sourceDraftV2Schema(sheet).safeParse(allMapped).success).toBe(true);
    expect(sourceDraftV2Schema(sheet, { notImportable: true }).safeParse(allMapped).success).toBe(false);
    expect(sourceDraftV2Schema(sheet, { notImportable: true }).safeParse({ ...allMapped, acknowledged: true }).success).toBe(true);
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

describe("preview gate (Save / Enable only on a successful preview of exactly this draft)", () => {
  const pick = { spreadsheetId: "S1", sheetId: 0, spreadsheetName: "FB", sheetTitle: "Leads" };
  const draft: SourceDraftV2 = { displayName: "FB", leadSourceDefault: "Google Sheets", idHeader: null, includeExisting: false,
    columns: [{ header: "Name", target: "full_name" }, { header: "Phone", target: "phone" }], ignored: ["Notes"], acknowledged: true };
  const NI = (o: Partial<NotImportable> = {}): NotImportable => ({ headerless: [], repeated: [], signature: null,
    beyond: { width: 10, checked_through: 10, headers: [], headerless: [], unchecked: false }, ...o });
  const data = (o: Partial<PreviewResult> = {}) => ({ title: "Leads", total_rows: 1, valid_rows: 1, invalid_rows: 0, imported_before: 0,
    duplicate_action: "flag", has_lead_created_workflows: false, rows: [], unaccounted_headers: [], not_importable: NI(), ...o }) as PreviewResult;
  const key = previewKey(draft, pick);
  const ready = (o: Partial<PreviewResult> = {}, k = key): PreviewState => ({ status: "ready", key: k, data: data(o) });

  it("the key is the exact request: mapping, identity and lead source change it; name, existing rows and the acknowledgement do not", () => {
    expect(JSON.parse(key)).toEqual(previewRequest(draft, pick));
    expect(previewRequest(draft, pick)).toEqual({ spreadsheet_id: "S1", sheet_id: 0, identity_mode: "row_position", id_header: null,
      lead_source_default: "Google Sheets", mapping: { v: 2, columns: draft.columns, ignored: ["Notes"] } });
    for (const same of [{ displayName: "Other" }, { includeExisting: true }, { acknowledged: false }]) expect(previewKey({ ...draft, ...same }, pick)).toBe(key);
    for (const other of [{ ignored: [] }, { idHeader: "Notes" }, { leadSourceDefault: "Facebook" }, { columns: draft.columns.slice(1) }]) {
      expect(previewKey({ ...draft, ...other }, pick)).not.toBe(key);
    }
    expect(previewKey(draft, { ...pick, sheetId: 7 })).not.toBe(key);
  });

  it("blocks while loading, after a failure, on a stale preview, on changed columns and without the acknowledgement", () => {
    expect(saveBlockers(draft, key, { status: "idle" })).toEqual(["loading"]);
    expect(saveBlockers(draft, key, { status: "loading", key })).toEqual(["loading"]);
    expect(saveBlockers(draft, key, { status: "error", key, message: "x", code: "google_error" })).toEqual(["failed"]);
    expect(saveBlockers(draft, key, ready({}, "other-draft"))).toEqual(["stale"]);
    expect(saveBlockers(draft, key, ready({ unaccounted_headers: ["Added"] }))).toEqual(["columns_changed"]);
    expect(saveBlockers({ ...draft, acknowledged: false }, key, ready())).toEqual(["acknowledge"]);
    expect(saveBlockers(draft, key, ready())).toEqual([]);
    const outside = ready({ not_importable: NI({ headerless: ["G"], signature: "a".repeat(64) }) });
    const noIgnored = { ...draft, columns: [...draft.columns, { header: "Notes", target: "notes" }], ignored: [], acknowledged: false };
    expect(saveBlockers(noIgnored, previewKey(noIgnored, pick), { ...outside, key: previewKey(noIgnored, pick) } as PreviewState)).toEqual(["acknowledge"]);
    expect(acknowledgementToken(outside)).toBe("a".repeat(64));
    expect([acknowledgementToken(ready()), acknowledgementToken({ status: "loading", key })]).toEqual([undefined, undefined]);
  });

  it("column errors lead to Review columns; not-importable content is described with labels and letters only", () => {
    expect(["unacknowledged_columns", "header:missing:Zip", "custom_field_unavailable"].map(isColumnsError)).toEqual([true, true, true]);
    expect(["google_error", "inspection_incomplete", null].map(isColumnsError)).toEqual([false, false, false]);
    expect(notImportableLines(NI({ headerless: ["G"], repeated: ["Notes"], signature: "x",
      beyond: { width: 450, checked_through: 400, headers: ["Spouse"], headerless: ["GU"], unchecked: true } }))).toEqual([
      "Data in columns without a header: G.",
      "Repeated headers (only unique headers can be imported): Notes.",
      "Past column GR, the 200-column limit: Spouse, column GU (no header).",
      "This tab is 450 columns wide. Columns past OJ weren't checked; nothing there is imported.",
    ]);
  });
});
