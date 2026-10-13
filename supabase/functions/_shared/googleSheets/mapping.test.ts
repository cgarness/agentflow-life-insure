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
