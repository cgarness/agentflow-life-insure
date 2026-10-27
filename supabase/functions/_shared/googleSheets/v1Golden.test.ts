// Run: deno test supabase/functions/_shared/googleSheets/v1Golden.test.ts
// Mapping v1 is FROZEN. fixtures/v1-golden.json was generated from the pre-v2 engine (main f980c16) and pins, for a
// corpus that includes the three production mapping shapes (anonymized), every value the import pipeline derives
// from a v1 mapping: validation, column resolution, custom-field resolution, planned rows (payloads, fingerprints,
// content signatures, display values), Lead ID classification, identity rows and both planners. Any byte of drift
// in v1 processing fails this test. Regenerate ONLY from the pre-v2 code: GS_WRITE_GOLDEN=1 deno test --allow-env
// --allow-write <this file>. (The fixture is imported as a JSON module, so the check itself needs no read permission.)
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { planRows } from "./engine.ts";
import { classifySourceIdRows, identityRows, planRowPosition, planSourceId, type LedgerRow, type PlannedRow } from "./identity.ts";
import { resolveColumns, resolveCustomFieldNames, validateMapping } from "./mapping.ts";
import golden from "./fixtures/v1-golden.json" with { type: "json" };

const FIXTURE = new URL("./fixtures/v1-golden.json", import.meta.url);

const id = (n: number) => `0000000${n}-0000-4000-8000-00000000000${n}`.slice(-36);
const F = { ad: id(1), amt: id(2), ben: id(3), benName: id(4), dt: id(5), hobby: id(6), gender: id(7), life: id(8),
  hist: id(9), interest: "0000000a-0000-4000-8000-00000000000a", platform: "0000000b-0000-4000-8000-00000000000b",
  status: "0000000c-0000-4000-8000-00000000000c", city: "0000000d-0000-4000-8000-00000000000d",
  zip: "0000000e-0000-4000-8000-00000000000e", shadow: "0000000f-0000-4000-8000-00000000000f" };
const field = (fid: string, name: string, created_by: string | null = "u1", created_at = "2026-08-05T00:00:00Z") =>
  ({ id: fid, name, created_by, created_at });
const FIELDS = [
  field(F.ad, "Ad"), field(F.amt, "Amt Requested"), field(F.ben, "Beneficiary"), field(F.benName, "Beneficiary Name"),
  field(F.dt, "Date/Time"), field(F.hobby, "Favorite Hobby"), field(F.gender, "Gender"), field(F.life, "Have Life Insurance"),
  field(F.hist, "History of Heart Attack Stroke Cancer"), field(F.interest, "Interested In"), field(F.platform, "Platform"),
  field(F.status, "Status"), field(F.city, "City"), field(F.zip, "Zip Code"), field(F.shadow, "Email", null),
];
const c = (header: string, target: string) => ({ header, target });

interface Case { name: string; mapping: unknown; header: string[]; rows: string[][]; idHeader: string | null; ledger?: LedgerRow[]; receipts?: string[] }

const PROD_19 = ["Ad", "Age", "Amt Requested", "Beneficiary", "Beneficiary Name", "Date/Time", "DOB", "Email", "Favorite Hobby",
  "First Name", "Gender", "Have Life Insurance", "History of Heart Attack Stroke Cancer", "Interested In", "Last Name", "Phone",
  "Platform", "State", "Status"];
const prod19Mapping = { v: 1, columns: [c("Ad", `custom:${F.ad}`), c("Age", "age"), c("Amt Requested", `custom:${F.amt}`),
  c("Beneficiary", `custom:${F.ben}`), c("Beneficiary Name", `custom:${F.benName}`), c("Date/Time", `custom:${F.dt}`),
  c("DOB", "date_of_birth"), c("Email", "email"), c("Favorite Hobby", `custom:${F.hobby}`), c("First Name", "first_name"),
  c("Gender", `custom:${F.gender}`), c("Have Life Insurance", `custom:${F.life}`),
  c("History of Heart Attack Stroke Cancer", `custom:${F.hist}`), c("Interested In", `custom:${F.interest}`),
  c("Last Name", "last_name"), c("Phone", "phone"), c("Platform", `custom:${F.platform}`), c("State", "state"),
  c("Status", `custom:${F.status}`)] };
const prodRow = (first: string, last: string, phone: string, extra: Partial<Record<string, string>> = {}) =>
  PROD_19.map((h) => extra[h] ?? ({ "First Name": first, "Last Name": last, Phone: phone, Email: `${first}@example.test`.toLowerCase(),
    State: "texas", Age: "61", DOB: "3/4/1965", "Amt Requested": "$10,000", "Date/Time": "10/27/2026 3:04 PM", Ad: "FE-1",
    Gender: "F", Status: "new" } as Record<string, string>)[h] ?? "");

const CASES: Case[] = [
  { name: "prod-5-standard", idHeader: null,
    mapping: { v: 1, columns: [c("Email", "email"), c("First Name", "first_name"), c("Last Name", "last_name"), c("Phone", "phone"), c("State", "state")] },
    header: ["First Name", "Last Name", "Phone", "Email", "State", "Address", "City", "Zip"],
    rows: [["Ann", "Lee", "(555) 010-2000", "ANN@EXAMPLE.TEST", "TX", "1 Main St", "Austin", "02134"],
      ["", "", "", "", "", "", "", ""], ["Bo", "", "5550102001", "", "ca", "", "", ""],
      ["Cy", "Diaz", "", "cy@example.test", "", "", "", ""], [" Dee ", " Ng ", " 555.010.2002 ", "", " florida ", "", "", "07001"]] },
  { name: "prod-19-custom", idHeader: null, mapping: prod19Mapping, header: PROD_19,
    rows: [prodRow("Ann", "Lee", "5550103000"), prodRow("Bo", "Ray", "5550103001", { "Amt Requested": "007", DOB: "13/45/1970" }),
      prodRow("Cy", "Diaz", "5550103002", { DOB: "25569", Age: "0", "Date/Time": "2026-10-27" }),
      prodRow("Dee", "Ng", "", {}), prodRow("Eve", "Fox", "5550103004", { Gender: "", Status: "", Ad: "  " })] },
  { name: "prod-21-city-zip", idHeader: null,
    mapping: { v: 1, columns: [...prod19Mapping.columns, c("City", `custom:${F.city}`), c("Zip", `custom:${F.zip}`)] },
    header: [...PROD_19, "City", "Zip"],
    rows: [[...prodRow("Ann", "Lee", "5550104000"), "Austin", "02134"], [...prodRow("Bo", "Ray", "5550104001"), "", "73301-1234"]] },
  { name: "full-name-and-optionals", idHeader: null,
    mapping: { v: 1, columns: [c("Name", "full_name"), c("Cell", "phone"), c("Source", "lead_source"), c("Notes", "notes"),
      c("Best Time", "best_time_to_call"), c("Birthday", "date_of_birth"), c("Years", "age")] },
    header: ["Name", "Cell", "Source", "Notes", "Best Time", "Birthday", "Years"],
    rows: [["Mary Ann  Smith", "555 010 5000", "Facebook", "call after 5", "evenings", "1970-3-4", "54.9"],
      ["Cher", "5550105001", "", "", "", "", ""], ["Jo Doe", "5550105002", " ", "x", "", "03/04/70", "abc"]] },
  { name: "source-id-mode", idHeader: "Lead ID",
    mapping: { v: 1, columns: [c("First", "first_name"), c("Last", "last_name"), c("Phone", "phone"), c("Coverage", `custom:${F.amt}`)] },
    header: ["Lead ID", "First", "Last", "Phone", "Coverage"],
    rows: [["A1", "Ann", "Lee", "5550106000", "100000"], ["A2", "Bo", "Ray", "5550106001", "$25,000.50"],
      ["A1", "Ann", "Lee", "5550106000", "100000"], ["A3", "Cy", "Diaz", "5550106002", "1"], ["A3", "Cy", "Diaz", "5550106002", "2"],
      ["", "Dee", "Ng", "5550106003", ""], ["a2", "Eve", "Fox", "", ""], ["", "", "", "", ""]],
    ledger: [{ k: "id:A1", n: 2, f: "x", kind: "baseline", reason: null }, { k: "id:a2", n: 8, f: "y", kind: "pending", reason: "missing_phone" }],
    receipts: ["id:A2"] },
  { name: "row-position-ledger", idHeader: null,
    mapping: { v: 1, columns: [c("First", "first_name"), c("Last", "last_name"), c("Phone", "phone")] },
    header: ["First", "Last", "Phone"],
    rows: [["Ann", "Lee", "5550107000"], ["Bo", "Ray", "5550107001"], ["Cy", "Diaz", "5550107002"]],
    ledger: [{ k: "pos:2", n: 2, f: "PLACEHOLDER", kind: "done", reason: null }] },
  { name: "header-problems", idHeader: "Lead ID",
    mapping: { v: 1, columns: [c("First Name", "first_name"), c("Last Name", "last_name"), c("Phone", "phone"), c("Gone", "notes")] },
    header: ["First Name", "Last Name", "Phone", "PHONE", ""], rows: [["Ann", "Lee", "1", "2", "x"]] },
  { name: "unresolved-custom", idHeader: null,
    mapping: { v: 1, columns: [c("First", "first_name"), c("Last", "last_name"), c("Phone", "phone"), c("Mail", `custom:${F.shadow}`),
      c("Ghost", "custom:99999999-9999-4999-8999-999999999999")] },
    header: ["First", "Last", "Phone", "Mail", "Ghost"], rows: [["Ann", "Lee", "5550108000", "a@b.test", "boo"]] },
  { name: "invalid-mappings", idHeader: null, mapping: { v: 2, columns: [] }, header: [], rows: [] },
  { name: "invalid-duplicate-target", idHeader: null,
    mapping: { v: 1, columns: [c("Phone", "phone"), c("Cell", "phone"), c("Name", "full_name")] }, header: [], rows: [] },
];

const sortObj = (m: Map<number, string>) => Object.fromEntries([...m.entries()].sort((a, b) => a[0] - b[0]));
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

async function compute(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const k of CASES) {
    const v = validateMapping(k.mapping);
    if (!v.ok) { out[k.name] = { validate: v }; continue; }
    const cols = resolveColumns(k.header, v.mapping, k.idHeader);
    const custom = resolveCustomFieldNames(cols.custom.map((x) => x.customFieldId), FIELDS);
    const planned: PlannedRow[] = await planRows(k.rows, cols, custom.names);
    const ledger = (k.ledger ?? []).map((l) => (l.f === "PLACEHOLDER" ? { ...l, f: planned.find((p) => p.n === l.n)?.fp ?? "" } : l));
    out[k.name] = plain({
      validate: v, cols, custom: { names: Object.fromEntries(custom.names), unresolved: custom.unresolved },
      planned, idClasses: sortObj(classifySourceIdRows(planned)),
      identityRowPosition: identityRows(planned, "row_position"), identitySourceId: identityRows(planned, "source_id", true),
      planRowPosition: planRowPosition(planned, ledger),
      planSourceId: planSourceId(planned, ledger, new Set(k.receipts ?? [])),
    });
  }
  return out;
}

Deno.test("mapping v1 is frozen: the pre-v2 golden corpus is reproduced byte for byte", async () => {
  const actual = await compute();
  if (Deno.env.get("GS_WRITE_GOLDEN") === "1") {
    await Deno.writeTextFile(FIXTURE, JSON.stringify(actual, null, 1) + "\n");
    return;
  }
  const expected = golden as Record<string, unknown>;
  assertEquals(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const name of Object.keys(expected)) assertEquals(actual[name], expected[name], `golden case ${name}`);
});
