// Run: deno test supabase/functions/_shared/googleSheets/
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildLead, fingerprint, parseDOB, resolveColumns, resolveCustomFieldNames, splitFullName, validateMapping, rowSignature } from "./mapping.ts";

const M = (cols: [string, string][]) => ({ v: 1 as const, columns: cols.map(([header, target]) => ({ header, target })) });

Deno.test("validateMapping: phone and a name are required; duplicates rejected", () => {
  assertEquals(validateMapping(M([["First", "first_name"], ["Last", "last_name"]])), { ok: false, reason: "phone_required" });
  assertEquals(validateMapping(M([["Phone", "phone"], ["First", "first_name"]])), { ok: false, reason: "name_required" });
  assert(validateMapping(M([["Phone", "phone"], ["Name", "full_name"]])).ok);
  assertEquals(validateMapping(M([["Phone", "phone"], ["phone ", "email"], ["Name", "full_name"]])).ok, false);
  assertEquals(validateMapping(M([["Phone", "phone"], ["Other", "phone"], ["Name", "full_name"]])).ok, false);
  assertEquals(validateMapping(M([["Phone", "phone"], ["Name", "full_name"], ["X", "custom:nope"]])).ok, false);
});

Deno.test("resolveColumns: by normalised name (columns may move); missing/duplicate are problems", () => {
  const m = M([["First Name", "first_name"], ["Last Name", "last_name"], ["Phone", "phone"]]);
  const r = resolveColumns(["phone", "  last   name", "First Name"], m, null);
  assertEquals(r.problems, []);
  assertEquals(r.std, { first_name: 2, last_name: 1, phone: 0 });
  assertEquals(resolveColumns(["First Name", "Phone"], m, null).problems, ["missing:Last Name"]);
  assertEquals(resolveColumns(["First Name", "Last Name", "Phone", "PHONE"], m, null).problems, ["duplicate:Phone"]);
  assertEquals(resolveColumns(["First Name", "Last Name", "Phone"], m, "Lead ID").problems, ["missing:Lead ID"]);
});

Deno.test("buildLead: CSV contract — Full name split, phone required, one-word name invalid, DOB, custom", () => {
  const m = M([["Name", "full_name"], ["Phone", "phone"], ["DOB", "date_of_birth"], ["Age", "age"], ["Gender", "custom:11111111-1111-1111-1111-111111111111"]]);
  const cols = resolveColumns(["Name", "Phone", "DOB", "Age", "Gender"], m, null);
  const names = new Map([["11111111-1111-1111-1111-111111111111", "Gender"]]);
  const ok = buildLead(["Mary Ann Smith", "(555) 010-2000", "3/4/1970", "0", "F"], cols, names);
  assert(ok.valid);
  assertEquals(ok.lead?.first_name, "Mary");
  assertEquals(ok.lead?.last_name, "Ann Smith");
  assertEquals(ok.lead?.date_of_birth, "1970-03-04");
  assertEquals(ok.lead?.age, undefined); // CSV: parseInt(...) || undefined
  assertEquals(ok.lead?.custom_fields, { "Full Name": "Mary Ann Smith", Gender: "F" });
  assertEquals(buildLead(["Cher", "5550102000", "", "", ""], cols, names).reason, "missing_name");
  assertEquals(buildLead(["Mary Smith", "", "", "", ""], cols, names).reason, "missing_phone");
  assertEquals(buildLead(["Mary Smith", "5550102000", "13/45/1970", "", ""], cols, names).reason, "invalid_dob");
  assertEquals(buildLead(["", "", "", "", ""], cols, names).reason, "empty");
});

Deno.test("buildLead: explicit first/last win over Full name; Full name used only when both blank", () => {
  const m = M([["First", "first_name"], ["Last", "last_name"], ["Name", "full_name"], ["Phone", "phone"]]);
  const cols = resolveColumns(["First", "Last", "Name", "Phone"], m, null);
  assertEquals(buildLead(["Jo", "", "Joanne Doe", "5551112222"], cols, new Map()).reason, "missing_name");
  assertEquals(buildLead(["", "", "Joanne Doe", "5551112222"], cols, new Map()).lead?.first_name, "Joanne");
});

Deno.test("fingerprint: core values only; edits to optional/unmapped columns keep it", async () => {
  const m = M([["First", "first_name"], ["Last", "last_name"], ["Phone", "phone"], ["Notes", "notes"]]);
  const cols = resolveColumns(["First", "Last", "Phone", "Notes", "Extra"], m, null);
  const a = buildLead(["Ann", "Lee", "555-000-1111", "x", "y"], cols, new Map());
  const b = buildLead([" ann ", "LEE", "5550001111", "changed", "other"], cols, new Map());
  assertEquals(await fingerprint(a.core), await fingerprint(b.core));
  const c = buildLead(["Ann", "Lee", "5550001112", "x", "y"], cols, new Map());
  assert((await fingerprint(a.core)) !== (await fingerprint(c.core)));
});

Deno.test("resolveCustomFieldNames: agency-wide representative; built-in shadow and missing fail closed", () => {
  const f = [
    { id: "b", name: "gender", created_by: "u1", created_at: "2024-01-01T00:00:00Z" },
    { id: "a", name: "Gender", created_by: null, created_at: "2025-01-01T00:00:00Z" },
    { id: "c", name: "Phone", created_by: null, created_at: null },
  ];
  const r = resolveCustomFieldNames(["b", "c", "zzz"], f);
  assertEquals(r.names.get("b"), "Gender");
  assertEquals(r.unresolved.sort(), ["c", "zzz"]);
});

Deno.test("parseDOB / splitFullName parity cases", () => {
  assertEquals(parseDOB("1970-3-4"), "1970-03-04");
  assertEquals(parseDOB("03/04/70"), "1970-03-04");
  assertEquals(parseDOB("25569"), "1970-01-01");
  assertEquals(parseDOB("2/30/1980"), null);
  assertEquals(splitFullName("  A  B   C "), { firstName: "A", lastName: "B C" });
});

Deno.test("rowSignature: every mapped value (standard, custom, Lead ID) counts; unmapped columns and outer spaces do not", async () => {
  const header = ["Lead ID", "First", "Last", "Phone", "Notes", "Coverage", "Unmapped"];
  const m = validateMapping({ v: 1, columns: [{ header: "First", target: "first_name" }, { header: "Last", target: "last_name" },
    { header: "Phone", target: "phone" }, { header: "Notes", target: "notes" },
    { header: "Coverage", target: "custom:33333333-3333-3333-3333-333333333333" }] });
  if (!m.ok) throw new Error("mapping");
  const cols = resolveColumns(header, m.mapping, "Lead ID");
  const base = ["X", "Ann", "Lee", "5550001111", "call am", "100000", "a"];
  const sig = (r: string[]) => rowSignature(r, cols);
  const s0 = await sig(base);
  assertEquals(await sig(["X", " Ann ", "Lee", "5550001111", "call am", "100000", "zzz"]), s0);
  for (const i of [0, 1, 2, 3, 4, 5]) {
    const changed = [...base];
    changed[i] = changed[i] + "!";
    assert((await sig(changed)) !== s0, `column ${header[i]} must change the signature`);
  }
});

// ---------------------------------------------------------------- mapping v2
import { analyzeHeaders, buildLeadDetailed, previewValues, resolveCustomFieldTypes, unaccountedHeaders } from "./mapping.ts";

const V2 = (cols: [string, string][], ignored: string[]) => ({ v: 2 as const, columns: cols.map(([header, target]) => ({ header, target })), ignored });
const CF = { amt: "22222222-2222-4222-8222-222222222222", when: "33333333-3333-4333-8333-333333333333", zip: "44444444-4444-4444-8444-444444444444",
  pick: "55555555-5555-4555-8555-555555555555" };

Deno.test("validateMapping v2: v1 column rules plus acknowledged ignored headers", () => {
  const base: [string, string][] = [["Phone", "phone"], ["Name", "full_name"]];
  assertEquals(validateMapping(V2(base, ["Address", " Notes "])), { ok: true, mapping: { v: 2, columns: [{ header: "Phone", target: "phone" },
    { header: "Name", target: "full_name" }], ignored: ["Address", "Notes"] } });
  assertEquals(validateMapping(V2(base, ["phone"])), { ok: false, reason: "ignored_header_mapped" });
  assertEquals(validateMapping(V2(base, ["X", " x "])), { ok: false, reason: "duplicate_header" });
  assertEquals(validateMapping(V2(base, [""])), { ok: false, reason: "invalid_mapping" });
  assertEquals(validateMapping({ v: 2, columns: base.map(([header, target]) => ({ header, target })) }), { ok: false, reason: "invalid_mapping" });
  assertEquals(validateMapping(V2([["First", "first_name"]], [])), { ok: false, reason: "phone_required" });
  assertEquals(validateMapping(V2(base, Array.from({ length: 199 }, (_, i) => `c${i}`))), { ok: false, reason: "invalid_mapping" });
  assertEquals(validateMapping({ v: 3, columns: [], ignored: [] }), { ok: false, reason: "invalid_mapping" });
});

Deno.test("resolveCustomFieldTypes: the type every visible row of the logical name agrees on; disagreement → no type", () => {
  const f = [
    { id: CF.amt, name: "Amt", created_by: "u1", created_at: null, type: "Number" },
    { id: "a2", name: " amt ", created_by: "u2", created_at: null, type: "Number" },
    { id: CF.when, name: "When", created_by: "u1", created_at: null, type: "Date" },
    { id: "w2", name: "when", created_by: null, created_at: null, type: "Text" },
    { id: CF.pick, name: "Pick", created_by: null, created_at: null, type: "Dropdown", dropdown_options: ["A", "B", 3] },
  ];
  const t = resolveCustomFieldTypes([CF.amt, CF.when, CF.pick, "missing"], f);
  assertEquals(t.get(CF.amt), { type: "Number", options: null });
  assertEquals(t.get(CF.when), { type: null });
  assertEquals(t.get(CF.pick), { type: "Dropdown", options: ["A", "B"] });
  assertEquals(t.has("missing"), false);
});

Deno.test("buildLead v2: lossless typed custom values; the same row under v1 stays raw; identity is unchanged", async () => {
  const header = ["Name", "Phone", "Amt", "When", "Zip"];
  const cols = [["Name", "full_name"], ["Phone", "phone"], ["Amt", `custom:${CF.amt}`], ["When", `custom:${CF.when}`], ["Zip", `custom:${CF.zip}`]] as [string, string][];
  const names = new Map([[CF.amt, "Amt"], [CF.when, "When"], [CF.zip, "ZIP Code"]]);
  const types = new Map([[CF.amt, { type: "Number" }], [CF.when, { type: "Date" }], [CF.zip, { type: "Text" }]]);
  const row = ["Ann Lee", "5550001111", "$1,234.50", "10/27/2026", "02134"];
  const r1 = resolveColumns(header, M(cols), null);
  const v1 = buildLead(row, r1, names);
  const v2 = buildLead(row, r1, names, { version: 2, types, locale: "en_US" });
  assertEquals(v1.lead?.custom_fields, { "Full Name": "Ann Lee", Amt: "$1,234.50", When: "10/27/2026", "ZIP Code": "02134" });
  assertEquals(v2.lead?.custom_fields, { "Full Name": "Ann Lee", Amt: "1234.50", When: "2026-10-27", "ZIP Code": "02134" });
  assertEquals(buildLead(row, r1, names, { version: 2, types, locale: "en_GB" }).lead?.custom_fields?.When, "10/27/2026");
  assertEquals(await fingerprint(v1.core), await fingerprint(v2.core));
  assertEquals(await rowSignature(row, r1), await rowSignature(row, resolveColumns(header, V2(cols, []), null)));
});

Deno.test("previewValues: exactly the values ingest stores (state normalised, source default, age integer, typed custom)", () => {
  const header = ["First", "Last", "Phone", "Email", "State", "Source", "Age", "DOB", "Best", "Notes", "Amt", "Zip", "Name"];
  const m = V2([["First", "first_name"], ["Last", "last_name"], ["Phone", "phone"], ["Email", "email"], ["State", "state"], ["Source", "lead_source"],
    ["Age", "age"], ["DOB", "date_of_birth"], ["Best", "best_time_to_call"], ["Notes", "notes"], ["Amt", `custom:${CF.amt}`], ["Zip", `custom:${CF.zip}`],
    ["Name", "full_name"]], []);
  const cols = resolveColumns(header, m, null);
  const names = new Map([[CF.amt, "Amt"], [CF.zip, "ZIP Code"]]);
  const opts = { version: 2 as const, types: new Map([[CF.amt, { type: "Number" }], [CF.zip, { type: "Text" }]]), locale: "en_US" };
  const row = ["Ann", "Lee", "5550001111", "Ann@X.test", "texas", "", "61.7", "3/4/1965", "pm", "", "007", "02134-0001", "Ann Lee"];
  const d = buildLeadDetailed(row, cols, names, opts);
  const pv = previewValues(d.built.lead!, cols, d.custom, "Google Sheets");
  assertEquals(pv, [
    { target: "full_name", value: "Ann Lee" }, { target: "email", value: "Ann@X.test" }, { target: "state", value: "TX" },
    { target: "lead_source", value: "Google Sheets" }, { target: "age", value: "61" }, { target: "date_of_birth", value: "1965-03-04" },
    { target: "best_time_to_call", value: "pm" },
    { target: `custom:${CF.amt}`, value: "007" }, { target: `custom:${CF.zip}`, value: "02134-0001" },
  ]);
  // Parity: every custom preview value is the payload value under the same name.
  assertEquals(d.built.lead?.custom_fields, { "Full Name": "Ann Lee", Amt: "007", "ZIP Code": "02134-0001" });
});

Deno.test("analyzeHeaders / unaccountedHeaders: blank, duplicate and data-bearing columns are explicit", () => {
  const header = ["First", "Last", "Phone", "", "Phone ", "Notes", "Lead ID", "Address"];
  const rows = [["a", "b", "1", "x", "", "", "L1", ""], ["", "", "", "", "", "", "", "1 Main"]];
  const a = analyzeHeaders(header, rows);
  assertEquals(a.map((c) => [c.index, c.blank, c.duplicate, c.has_data]),
    [[0, false, false, true], [1, false, false, true], [2, false, true, true], [3, true, false, true], [4, false, true, false],
     [5, false, false, false], [6, false, false, true], [7, false, false, true]]);
  assertEquals(analyzeHeaders(["A"], [["1", "2", ""]]).map((c) => [c.index, c.blank, c.has_data]), [[0, false, true], [1, true, true], [2, true, false]]);
  const m = V2([["First", "first_name"], ["Last", "last_name"]], ["notes"]);
  assertEquals(unaccountedHeaders(header, { ...m, columns: [...m.columns, { header: "Phone", target: "phone" }] }, "Lead ID"), ["Address"]);
  assertEquals(unaccountedHeaders(header, M([["First", "first_name"], ["Last", "last_name"], ["Phone", "phone"]]), null), ["Notes", "Lead ID", "Address"]);
});
