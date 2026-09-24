import { describe, it, expect } from "vitest";
import {
  editModeLeadFields,
  formatLeadFieldValue,
  isHiddenLeadCustomKey,
  resolveTeamOpenLeadFields,
  TEAM_OPEN_STANDARD_FIELDS,
  visibleLeadFields,
  type ResolvedLeadField,
} from "@/lib/dialerLeadFields";
import { getDefaultFieldOrder, leadLayoutIdsToDialerDescriptors, resolveFieldOrder } from "@/lib/contactFieldLayout";
import type { CustomField } from "@/lib/types";

const def = (name: string, type: CustomField["type"] = "Text", extra: Partial<CustomField> = {}): CustomField => ({
  id: `id-${name}`,
  name,
  type,
  appliesTo: ["Leads"],
  required: false,
  active: true,
  usageCount: 0,
  createdBy: null,
  scope: "agency",
  ...extra,
});

// Team/Open queue row as the loader builds it when RLS hid the master: snapshot columns only.
const snapshot = {
  id: "cl-1",
  lead_id: "lead-1",
  first_name: "Ada",
  last_name: "Lovelace",
  phone: "5551234567",
  email: "ada@example.com",
  state: "TX",
  age: 0,
  source: "",
  status: "Queued",
  call_attempts: 2,
  locked_by: "agent-9",
  organization_id: "org-1",
  lead_score: 99,
};

const master = {
  id: "lead-1",
  first_name: "Ada",
  last_name: "Lovelace",
  phone: "5551234567",
  email: "ada@example.com",
  state: "TX",
  lead_source: "Facebook",
  age: 44,
  date_of_birth: "1980-12-10",
  best_time_to_call: "   ",
  spouse_info: { name: "Charles" },
  notes: null,
  assigned_agent_id: null,
  user_id: null,
  lead_score: 7,
  custom_fields: {
    "Coverage Amount": 250000,
    Smoker: false,
    "Policy Goal": "Final expense",
    "Imported Only": "kept from CSV",
    Empty: "",
    Hobbies: ["golf", "chess"],
    Nested: { a: 1 },
    additional_policies: [{ carrier: "X" }],
    __agentflow: { duplicateImport: true },
    tags: ["Duplicate"],
    Phone: "555-000-1111",
  },
};

const byId = (fields: ResolvedLeadField[]) => new Map(fields.map((f) => [f.id, f]));
const ids = (fields: ResolvedLeadField[]) => fields.map((f) => f.id);

const resolve = (over: Partial<Parameters<typeof resolveTeamOpenLeadFields>[0]> = {}) =>
  resolveTeamOpenLeadFields({
    layoutIds: getDefaultFieldOrder("lead"),
    sources: { snapshot, master },
    definitions: [def("Coverage Amount", "Number"), def("Smoker"), def("Policy Goal", "Dropdown", { dropdownOptions: ["Final expense", "Term"] }), def("Beneficiary"), def("Phone")],
    agents: [{ id: "agent-1", firstName: "Grace", lastName: "Hopper" }],
    ...over,
  });

describe("resolveTeamOpenLeadFields — custom values (Team / Open)", () => {
  it("reads custom descriptors from custom_fields[<canonical name>], not the top-level row", () => {
    const f = byId(resolve());
    expect(f.get("custom:Coverage Amount")?.display).toBe("250000");
    expect(f.get("custom:Policy Goal")?.display).toBe("Final expense");
  });

  it("shows a populated imported field that the saved layout does not list (layout is ordering, not inventory)", () => {
    const fields = resolve({ layoutIds: ["firstName", "lastName"] });
    const f = byId(fields);
    expect(f.get("custom:Imported Only")?.display).toBe("kept from CSV");
    expect(f.get("custom:Imported Only")?.editable).toBe(false); // no definition → read-only (D-1)
    expect(f.get("std:dateOfBirth")?.display).toBe("12/10/1980");
  });

  it("keeps 0 and false, hides null / empty / whitespace-only, joins primitive lists", () => {
    const f = byId(resolve());
    expect(f.get("std:age")?.display).toBe("0"); // snapshot 0 wins and is kept
    expect(f.get("custom:Smoker")?.display).toBe("No");
    expect(f.get("custom:Empty")?.display).toBeNull();
    expect(f.get("std:bestTimeToCall")?.display).toBeNull();
    expect(f.get("custom:Hobbies")?.display).toBe("golf, chess");
  });

  it("never renders an object as '[object Object]' and never makes it editable", () => {
    const fields = resolve();
    for (const x of fields) expect(x.display ?? "").not.toContain("[object Object]");
    const f = byId(fields);
    expect(f.get("custom:Nested")?.display).toBeNull();
    expect(f.get("custom:Nested")?.editable).toBe(false);
    expect(f.get("std:spouseInfo")?.display).toBeNull();
    expect(f.get("std:spouseInfo")?.editable).toBe(false);
  });

  it("never exposes internal / reserved keys or internal columns", () => {
    const all = ids(resolve({ layoutIds: [...getDefaultFieldOrder("lead"), "leadScore", "custom:additional_policies", "custom:__agentflow", "custom:tags", "healthStatus"] }));
    for (const hidden of ["custom:additional_policies", "custom:__agentflow", "custom:tags"]) expect(all).not.toContain(hidden);
    expect(all.some((i) => /score|lock|organization|call_attempts|lead_id|health/i.test(i))).toBe(false);
    expect(isHiddenLeadCustomKey("additional_policies")).toBe(true);
    expect(isHiddenLeadCustomKey("__anything")).toBe(true);
    expect(isHiddenLeadCustomKey("tags")).toBe(true);
    expect(isHiddenLeadCustomKey("Policy Goal")).toBe(false);
  });
});

describe("identity, collisions and ordering", () => {
  it("keeps a custom 'Phone' distinct from the standard phone (key, value and label)", () => {
    const f = byId(resolve());
    expect(f.get("std:phone")?.display).toBe("5551234567");
    expect(f.get("custom:Phone")?.display).toBe("555-000-1111");
    expect(f.get("custom:Phone")?.label).toBe("Phone (custom)");
    expect(f.get("std:phone")?.label).toBe("Phone");
    const all = ids(resolve());
    expect(new Set(all).size).toBe(all.length);
  });

  it("preserves user layout order first, then agency order, then defaults, then appends the rest", () => {
    const user = ["custom:Policy Goal", "phone", "firstName"];
    const agency = ["email", "firstName"];
    expect(ids(resolve({ layoutIds: resolveFieldOrder("lead", user, agency) })).slice(0, 3)).toEqual([
      "custom:Policy Goal",
      "std:phone",
      "std:firstName",
    ]);
    expect(ids(resolve({ layoutIds: resolveFieldOrder("lead", undefined, agency) })).slice(0, 2)).toEqual(["std:email", "std:firstName"]);
    const rest = ids(resolve({ layoutIds: ["firstName"] }));
    // Remaining standard fields in registry order, then definitions by name, then undefined bag keys.
    const stdOrder = TEAM_OPEN_STANDARD_FIELDS.map((s) => `std:${s.id}`).filter((i) => i !== "std:firstName");
    expect(rest.slice(1, 1 + stdOrder.length)).toEqual(stdOrder);
    const customs = rest.filter((i) => i.startsWith("custom:"));
    expect(customs.slice(0, 5)).toEqual(["custom:Beneficiary", "custom:Coverage Amount", "custom:Phone", "custom:Policy Goal", "custom:Smoker"]);
    expect(customs.slice(5)).toEqual(["custom:Empty", "custom:Hobbies", "custom:Imported Only", "custom:Nested"]);
  });

  it("uses the same labels as the global dialer registry for shared standard ids", () => {
    const global = leadLayoutIdsToDialerDescriptors(TEAM_OPEN_STANDARD_FIELDS.map((s) => s.id));
    for (const g of global) {
      const mine = TEAM_OPEN_STANDARD_FIELDS.find((s) => s.label === g.label);
      expect(mine, g.label).toBeDefined();
    }
  });
});

describe("source mapping and master availability", () => {
  it("Source reads leads.lead_source (the snapshot 'source' is only a fallback)", () => {
    expect(byId(resolve()).get("std:leadSource")?.display).toBe("Facebook");
    expect(byId(resolve({ sources: { snapshot: { ...snapshot, source: "Import" }, master: { ...master, lead_source: "" } } })).get("std:leadSource")?.display).toBe("Import");
    expect(byId(resolve()).get("std:leadSource")?.editable).toBe(false); // D-4
  });

  it("resolves the assigned agent to a name and never shows a raw id", () => {
    const f = byId(resolve({ sources: { snapshot, master: { ...master, assigned_agent_id: "agent-1" } } }));
    expect(f.get("std:assignedAgentId")?.display).toBe("Grace Hopper");
    expect(f.get("std:assignedAgentId")?.editable).toBe(false);
    const unknown = byId(resolve({ sources: { snapshot, master: { ...master, assigned_agent_id: "agent-x" } } }));
    expect(unknown.get("std:assignedAgentId")?.display).toBeNull();
  });

  it("without the master row: snapshot fields only, nothing editable, no custom values", () => {
    const fields = resolve({ sources: { snapshot, master: null } });
    expect(fields.every((f) => !f.editable)).toBe(true);
    const visible = visibleLeadFields(fields).map((f) => f.id);
    expect(visible).toEqual(expect.arrayContaining(["std:firstName", "std:phone", "std:state", "std:age"]));
    expect(visible.some((i) => i.startsWith("custom:"))).toBe(false);
    expect(visible).not.toContain("std:dateOfBirth");
  });

  it("edit mode lists supported empty agency fields; view mode hides them", () => {
    const fields = resolve();
    expect(editModeLeadFields(fields).map((f) => f.id)).toContain("custom:Beneficiary");
    expect(visibleLeadFields(fields).map((f) => f.id)).not.toContain("custom:Beneficiary");
    expect(byId(fields).get("custom:Beneficiary")?.editValue).toBe("");
  });

  it("definitions unavailable (failed read) → saved values still shown, read-only; never treated as none", () => {
    const f = byId(resolve({ definitions: null }));
    expect(f.get("custom:Policy Goal")?.display).toBe("Final expense");
    expect(f.get("custom:Policy Goal")?.editable).toBe(false);
  });

  it("ignores inactive definitions and ones that do not apply to Leads", () => {
    const f = byId(resolve({ definitions: [def("Beneficiary", "Text", { active: false }), def("Carrier", "Text", { appliesTo: ["Clients"] })] }));
    expect(f.has("custom:Beneficiary")).toBe(false);
    expect(f.has("custom:Carrier")).toBe(false);
  });
});

describe("formatLeadFieldValue", () => {
  it.each([
    [0, "0"],
    [false, "No"],
    [true, "Yes"],
    ["  ", null],
    [null, null],
    [undefined, null],
    [NaN, null],
    [{ x: 1 }, null],
    [[{ x: 1 }], null],
    [["a", 2, true], "a, 2, Yes"],
  ])("%j → %j", (input, out) => {
    expect(formatLeadFieldValue(input)).toBe(out);
  });
});
